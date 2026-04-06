/**
 * Goals Engine — persistent objectives that agents work toward over time.
 * Goals decompose into steps, executed via OpenClaw or local agents.
 */
import { db } from "@workspace/db";
import { agentGoalsTable, agentGoalStepsTable, agentsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { createJob, hasActiveJob, emitJobEvent } from "./agentEventBus";
import { runOpenclawChat } from "./openclawProxy";
import { runAgentChat } from "./agentRunner";
import { persistAndEmitActivity } from "./activityEmitter";

async function getModel(): Promise<string> {
  const { appSettingsTable } = await import("@workspace/db");
  const [s] = await db.select().from(appSettingsTable).limit(1);
  return s?.aiModel ?? "google/gemini-2.5-flash";
}

/**
 * Create a goal and auto-decompose it into steps using the LLM.
 */
export async function createGoal(
  agentId: number,
  title: string,
  description?: string,
  successCriteria?: string,
  deadline?: Date,
): Promise<{ goalId: number; steps: string[] }> {
  const [goal] = await db.insert(agentGoalsTable).values({
    agentId,
    title,
    description: description || null,
    successCriteria: successCriteria || null,
    deadline: deadline || null,
  }).returning();

  const goalId = goal!.id;

  // Get agent info for context
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  const agentName = agent?.name || "Agent";

  // Decompose goal into steps using LLM
  const model = await getModel();
  let steps: string[] = [];

  try {
    const decomposition = await openai.chat.completions.create({
      model,
      max_completion_tokens: 500,
      messages: [
        {
          role: "system",
          content: `You decompose goals into 3-7 concrete, actionable steps. Each step should be one clear action that an AI agent (${agentName}) can execute. Return ONLY a numbered list, one step per line. No preamble.`,
        },
        {
          role: "user",
          content: `Goal: ${title}${description ? `\nDetails: ${description}` : ""}${successCriteria ? `\nSuccess criteria: ${successCriteria}` : ""}`,
        },
      ],
    });

    const text = decomposition.choices?.[0]?.message?.content || "";
    steps = text
      .split("\n")
      .map(l => l.replace(/^\d+[\.\)]\s*/, "").trim())
      .filter(l => l.length > 5);
  } catch {
    steps = [title]; // Fallback: single step = the goal itself
  }

  // Insert steps
  for (let i = 0; i < steps.length; i++) {
    await db.insert(agentGoalStepsTable).values({
      goalId,
      stepOrder: i + 1,
      description: steps[i]!,
    });
  }

  void persistAndEmitActivity({
    agentId,
    agentName,
    actionType: "goal_created",
    detail: `New goal: "${title}" (${steps.length} steps)`,
    timestamp: new Date().toISOString(),
  });

  return { goalId, steps };
}

/**
 * Execute the next pending step of a goal.
 */
export async function executeNextStep(goalId: number): Promise<{ executed: boolean; stepId?: number; error?: string }> {
  const [goal] = await db.select().from(agentGoalsTable).where(eq(agentGoalsTable.id, goalId));
  if (!goal || goal.status !== "active") return { executed: false, error: "Goal not active" };

  // Check if agent is busy
  if (hasActiveJob(goal.agentId)) return { executed: false, error: "Agent is busy" };

  // Find next pending step
  const [step] = await db.select().from(agentGoalStepsTable)
    .where(and(eq(agentGoalStepsTable.goalId, goalId), eq(agentGoalStepsTable.status, "pending")))
    .orderBy(asc(agentGoalStepsTable.stepOrder))
    .limit(1);

  if (!step) {
    // All steps done — mark goal complete
    await db.update(agentGoalsTable).set({ status: "completed", progress: 100, updatedAt: new Date() }).where(eq(agentGoalsTable.id, goalId));
    return { executed: false, error: "All steps complete" };
  }

  // Mark step as running
  await db.update(agentGoalStepsTable).set({ status: "running" }).where(eq(agentGoalStepsTable.id, step.id));

  // Execute via agent
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, goal.agentId));
  if (!agent) return { executed: false, error: "Agent not found" };

  const jobId = createJob(goal.agentId);
  const prompt = `[GOAL: ${goal.title}]\nExecute this step: ${step.description}${goal.successCriteria ? `\nSuccess criteria: ${goal.successCriteria}` : ""}`;

  // Fire-and-forget — the event bus will track completion
  if (agent.openclawAgentId) {
    runOpenclawChat(jobId, goal.agentId, agent.openclawAgentId, prompt, null).then(async () => {
      await onStepComplete(goalId, step.id, jobId);
    }).catch(async (err) => {
      await onStepFailed(goalId, step.id, String(err));
    });
  } else {
    runAgentChat(jobId, goal.agentId, prompt, null).then(async () => {
      await onStepComplete(goalId, step.id, jobId);
    }).catch(async (err) => {
      await onStepFailed(goalId, step.id, String(err));
    });
  }

  void persistAndEmitActivity({
    agentId: goal.agentId,
    agentName: agent.name,
    actionType: "goal_step",
    detail: `Step ${step.stepOrder}: ${step.description.substring(0, 80)}`,
    timestamp: new Date().toISOString(),
  });

  return { executed: true, stepId: step.id };
}

async function onStepComplete(goalId: number, stepId: number, jobId: string): Promise<void> {
  // Get the answer from job events
  const { getJobEvents } = await import("./agentEventBus");
  const events = getJobEvents(jobId);
  const answer = events.filter(e => e.type === "content").map(e => String(e.data)).join("");

  await db.update(agentGoalStepsTable).set({
    status: "done",
    result: answer.substring(0, 5000),
    completedAt: new Date(),
  }).where(eq(agentGoalStepsTable.id, stepId));

  await updateGoalProgress(goalId);
}

async function onStepFailed(goalId: number, stepId: number, error: string): Promise<void> {
  await db.update(agentGoalStepsTable).set({
    status: "failed",
    result: `Error: ${error.substring(0, 1000)}`,
    completedAt: new Date(),
  }).where(eq(agentGoalStepsTable.id, stepId));

  await updateGoalProgress(goalId);
}

async function updateGoalProgress(goalId: number): Promise<void> {
  const steps = await db.select().from(agentGoalStepsTable).where(eq(agentGoalStepsTable.goalId, goalId));
  if (steps.length === 0) return;

  const done = steps.filter(s => s.status === "done" || s.status === "skipped").length;
  const failed = steps.filter(s => s.status === "failed").length;
  const progress = Math.round((done / steps.length) * 100);

  const allDone = done + failed === steps.length;
  const status = allDone ? (failed > 0 && done === 0 ? "failed" : "completed") : "active";

  await db.update(agentGoalsTable).set({ progress, status, updatedAt: new Date() }).where(eq(agentGoalsTable.id, goalId));
}
