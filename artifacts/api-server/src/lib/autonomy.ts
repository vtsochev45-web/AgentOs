/**
 * Autonomy Engine — the 5 breakthroughs that make AgentOS alive.
 *
 * 1. Goal Health: momentum, stagnation detection, auto-pause
 * 2. Confidence Gating: simulate/ask/execute based on confidence
 * 3. Idle Thinking: background cognition when agents are quiet
 * 4. Agent Budgets: per-agent spend tracking and limits
 * 5. Self-Improving Prompts: agents evolve their own personas
 */
import { db } from "@workspace/db";
import { agentGoalsTable, agentGoalStepsTable, agentsTable, agentJobEventsTable, appSettingsTable } from "@workspace/db";
import { eq, sql, and, lt, desc } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";
import { persistAndEmitActivity } from "./activityEmitter";
import { logger } from "./logger";

// ── 1. Goal Health Metrics ───────────────────────────────────

/**
 * Update goal momentum and detect stagnation.
 * Called by the goal scheduler every tick.
 *
 * Momentum = steps completed in last hour (0-1 scale).
 * Stagnation = consecutive ticks with no progress.
 * Auto-pauses goals stagnant for 10+ ticks (~10 min).
 */
export async function updateGoalHealth(): Promise<void> {
  const activeGoals = await db.select().from(agentGoalsTable)
    .where(eq(agentGoalsTable.status, "active"));

  for (const goal of activeGoals) {
    const oneHourAgo = new Date(Date.now() - 3600_000);
    const recentSteps = await db.select().from(agentGoalStepsTable)
      .where(and(
        eq(agentGoalStepsTable.goalId, goal.id),
        eq(agentGoalStepsTable.status, "done"),
      ));

    const recentCount = recentSteps.filter(s =>
      s.completedAt && new Date(s.completedAt) > oneHourAgo
    ).length;
    const totalSteps = await db.select().from(agentGoalStepsTable)
      .where(eq(agentGoalStepsTable.goalId, goal.id));

    const momentum = totalSteps.length > 0 ? recentCount / totalSteps.length : 0;
    const wasStagnant = recentCount === 0 && goal.progress! > 0 && goal.progress! < 100;
    const stagnantTicks = wasStagnant ? (goal.stagnantTicks || 0) + 1 : 0;

    const updates: Record<string, unknown> = {
      momentum,
      stagnantTicks,
      updatedAt: new Date(),
    };

    // Auto-pause stagnant goals (10 ticks = ~10 min with no progress)
    if (stagnantTicks >= 10) {
      updates.status = "paused";
      void persistAndEmitActivity({
        agentId: goal.agentId,
        agentName: null,
        actionType: "goal_paused",
        detail: `Goal "${goal.title}" auto-paused: stagnant for ${stagnantTicks} ticks`,
        timestamp: new Date().toISOString(),
      });
    }

    await db.update(agentGoalsTable).set(updates).where(eq(agentGoalsTable.id, goal.id));
  }
}

// ── 2. Confidence-Based Action Gating ────────────────────────

export type ConfidenceLevel = "low" | "medium" | "high";

/**
 * Estimate confidence for an action based on:
 * - Agent's past success rate with this tool
 * - Risk level of the action
 * - Whether it's reversible
 *
 * Returns: low (simulate), medium (ask human), high (execute)
 */
export async function estimateConfidence(
  agentId: number,
  actionType: string,
): Promise<{ level: ConfidenceLevel; score: number; reason: string }> {
  // Irreversible actions
  const irreversible = ["send_email", "website_deploy", "vps_shell"];
  const isIrreversible = irreversible.includes(actionType);

  // Check agent's success rate with this tool type
  const since = new Date(Date.now() - 7 * 86400_000);
  const jobRows = await db.execute(sql`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors
    FROM agent_job_events
    WHERE agent_id = ${agentId} AND created_at >= ${since}
  `);

  const r = (jobRows.rows as any[])[0];
  const total = Number(r?.total || 0);
  const errors = Number(r?.errors || 0);
  const successRate = total > 0 ? (total - errors) / total : 0.5; // Default 50% if no history

  // Score: 0-1
  let score = successRate;
  if (isIrreversible) score *= 0.7; // Penalty for irreversible
  if (total < 3) score *= 0.8; // Penalty for low history

  // Map to confidence level
  let level: ConfidenceLevel;
  let reason: string;

  if (score >= 0.8) {
    level = "high";
    reason = `High confidence (${Math.round(score * 100)}%): good history, executing directly`;
  } else if (score >= 0.5) {
    level = "medium";
    reason = `Medium confidence (${Math.round(score * 100)}%): requesting approval`;
  } else {
    level = "low";
    reason = `Low confidence (${Math.round(score * 100)}%): simulating only`;
  }

  return { level, score, reason };
}

// ── 3. Idle Thinking Cycles ──────────────────────────────────

/**
 * Background cognition — when all agents are idle, the system thinks.
 * Reviews active goals, identifies opportunities, suggests optimizations.
 * Called by the goal scheduler when no goals need execution.
 */
export async function idleThink(): Promise<void> {
  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    const model = settings?.aiModel ?? "google/gemini-2.5-flash";

    // Gather system state
    const goals = await db.select().from(agentGoalsTable);
    const agents = await db.select().from(agentsTable);
    const activeGoals = goals.filter(g => g.status === "active");
    const pausedGoals = goals.filter(g => g.status === "paused");
    const completedGoals = goals.filter(g => g.status === "completed");

    if (goals.length === 0) return; // Nothing to think about

    const stateSnapshot = `
System State:
- ${agents.length} agents registered
- ${activeGoals.length} active goals, ${pausedGoals.length} paused, ${completedGoals.length} completed
- Active goals: ${activeGoals.map(g => `"${g.title}" (${g.progress}%, momentum: ${(g.momentum || 0).toFixed(2)})`).join("; ") || "none"}
- Paused goals: ${pausedGoals.map(g => `"${g.title}" (stagnant ${g.stagnantTicks} ticks)`).join("; ") || "none"}
    `.trim();

    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 200,
      messages: [
        {
          role: "system",
          content: "You are the AgentOS idle thinking system. Given the current system state, output 0-2 actionable insights. Format: one per line, keep each under 100 chars. If nothing useful, output: idle",
        },
        { role: "user", content: stateSnapshot },
      ],
    });

    const text = response.choices?.[0]?.message?.content || "";
    if (text.trim().toLowerCase() === "idle") return;

    const insights = text.split("\n").filter(l => l.trim().length > 5).slice(0, 2);
    for (const insight of insights) {
      void persistAndEmitActivity({
        agentId: null,
        agentName: "System",
        actionType: "idle_think",
        detail: insight.trim().substring(0, 200),
        timestamp: new Date().toISOString(),
      });
    }
  } catch {
    // Idle thinking is best-effort
  }
}

// ── 4. Agent Budgets ─────────────────────────────────────────

/**
 * Check if agent has budget remaining. Resets daily.
 */
export async function checkAgentBudget(agentId: number): Promise<{ allowed: boolean; remaining: number; reason: string }> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return { allowed: false, remaining: 0, reason: "Agent not found" };

  // No budget set = unlimited
  if (!agent.budgetDailyCents) return { allowed: true, remaining: Infinity, reason: "No budget limit" };

  // Reset if new day
  const now = new Date();
  const resetAt = agent.budgetResetAt ? new Date(agent.budgetResetAt) : null;
  if (!resetAt || resetAt.toDateString() !== now.toDateString()) {
    await db.update(agentsTable).set({
      budgetSpentTodayCents: 0,
      budgetResetAt: now,
    }).where(eq(agentsTable.id, agentId));
    return { allowed: true, remaining: agent.budgetDailyCents, reason: "Budget reset for new day" };
  }

  const spent = agent.budgetSpentTodayCents || 0;
  const remaining = agent.budgetDailyCents - spent;

  if (remaining <= 0) {
    return { allowed: false, remaining: 0, reason: `Daily budget exhausted (${spent}¢ spent)` };
  }

  return { allowed: true, remaining, reason: `${remaining}¢ remaining of ${agent.budgetDailyCents}¢ daily` };
}

/**
 * Record spend for an agent.
 */
export async function recordAgentSpend(agentId: number, cents: number): Promise<void> {
  await db.update(agentsTable)
    .set({ budgetSpentTodayCents: sql`COALESCE(budget_spent_today_cents, 0) + ${Math.round(cents)}` })
    .where(eq(agentsTable.id, agentId));
}

// ── 5. Self-Improving Prompts ────────────────────────────────

/**
 * After enough interactions, let the agent evolve its own persona.
 * Runs periodically — looks at last 10 jobs + memories, proposes improvements.
 */
export async function evolveAgentPersona(agentId: number): Promise<{ evolved: boolean; newPersona?: string }> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) return { evolved: false };

  // Only evolve if agent has enough history (10+ jobs)
  const jobCount = await db.execute(sql`
    SELECT COUNT(DISTINCT job_id) as cnt
    FROM agent_job_events
    WHERE agent_id = ${agentId}
  `);
  const cnt = Number((jobCount.rows as any[])[0]?.cnt || 0);
  if (cnt < 10) return { evolved: false };

  // Only evolve once per day
  const version = agent.personaVersion || 0;
  // Simple throttle: check version against day of year
  const dayOfYear = Math.floor((Date.now() - new Date(new Date().getFullYear(), 0, 0).getTime()) / 86400_000);
  if (version >= dayOfYear) return { evolved: false };

  try {
    const [settings] = await db.select().from(appSettingsTable).limit(1);
    const model = settings?.aiModel ?? "google/gemini-2.5-flash";

    // Get recent performance summary
    const perfRows = await db.execute(sql`
      SELECT
        AVG((event_data->>'duration_ms')::int) as avg_duration,
        AVG((event_data->>'tokens_out')::int) as avg_tokens,
        SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors,
        COUNT(DISTINCT job_id) as jobs
      FROM agent_job_events
      WHERE agent_id = ${agentId}
        AND created_at >= ${new Date(Date.now() - 7 * 86400_000)}
    `);
    const perf = (perfRows.rows as any[])[0] || {};

    const response = await openai.chat.completions.create({
      model,
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You optimize AI agent personas. Given the agent's current persona and performance data, suggest an improved version. Keep the core identity but sharpen: specificity, efficiency, tool usage patterns, and communication style. Output ONLY the new persona text, nothing else.`,
        },
        {
          role: "user",
          content: `Agent: ${agent.name}
Current persona: ${agent.persona}
Performance (7d): ${perf.jobs || 0} jobs, avg ${((perf.avg_duration || 0) / 1000).toFixed(1)}s, ${perf.errors || 0} errors, avg ${perf.avg_tokens || 0} tokens
${agent.evolvedPersona ? `Previous evolution: ${agent.evolvedPersona.substring(0, 200)}` : ""}`,
        },
      ],
    });

    const newPersona = response.choices?.[0]?.message?.content?.trim();
    if (!newPersona || newPersona.length < 20) return { evolved: false };

    await db.update(agentsTable).set({
      evolvedPersona: newPersona,
      personaVersion: dayOfYear,
    }).where(eq(agentsTable.id, agentId));

    void persistAndEmitActivity({
      agentId,
      agentName: agent.name,
      actionType: "persona_evolved",
      detail: `Persona v${dayOfYear}: ${newPersona.substring(0, 100)}...`,
      timestamp: new Date().toISOString(),
    });

    return { evolved: true, newPersona };
  } catch {
    return { evolved: false };
  }
}
