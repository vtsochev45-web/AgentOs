import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { agentGoalsTable, agentGoalStepsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireApiKey } from "../middlewares/requireApiKey";
import { createGoal, executeNextStep } from "../lib/goals";

const router: IRouter = Router();

// List all goals
router.get("/goals", requireApiKey, async (req, res): Promise<void> => {
  const status = req.query.status ? String(req.query.status) : undefined;
  let query = db.select().from(agentGoalsTable).orderBy(desc(agentGoalsTable.createdAt));
  const goals = status
    ? await db.select().from(agentGoalsTable).where(eq(agentGoalsTable.status, status)).orderBy(desc(agentGoalsTable.createdAt))
    : await query;
  res.json(goals);
});

// Get goal with steps
router.get("/goals/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [goal] = await db.select().from(agentGoalsTable).where(eq(agentGoalsTable.id, id));
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  const steps = await db.select().from(agentGoalStepsTable)
    .where(eq(agentGoalStepsTable.goalId, id))
    .orderBy(agentGoalStepsTable.stepOrder);
  res.json({ ...goal, steps });
});

// Create goal
router.post("/goals", requireApiKey, async (req, res): Promise<void> => {
  const { agentId, title, description, successCriteria, deadline } = req.body as {
    agentId: number; title: string; description?: string; successCriteria?: string; deadline?: string;
  };
  if (!agentId || !title) { res.status(400).json({ error: "agentId and title required" }); return; }

  try {
    const result = await createGoal(agentId, title, description, successCriteria, deadline ? new Date(deadline) : undefined);
    const [goal] = await db.select().from(agentGoalsTable).where(eq(agentGoalsTable.id, result.goalId));
    const steps = await db.select().from(agentGoalStepsTable)
      .where(eq(agentGoalStepsTable.goalId, result.goalId))
      .orderBy(agentGoalStepsTable.stepOrder);
    res.status(201).json({ ...goal, steps });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to create goal" });
  }
});

// Update goal (status, priority)
router.patch("/goals/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { status, priority } = req.body as { status?: string; priority?: string };
  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (status) updates.status = status;
  if (priority) updates.priority = priority;
  const [goal] = await db.update(agentGoalsTable).set(updates).where(eq(agentGoalsTable.id, id)).returning();
  if (!goal) { res.status(404).json({ error: "Goal not found" }); return; }
  res.json(goal);
});

// Manually trigger next step
router.post("/goals/:id/execute", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const result = await executeNextStep(id);
  res.json(result);
});

// Delete goal
router.delete("/goals/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  await db.delete(agentGoalStepsTable).where(eq(agentGoalStepsTable.goalId, id));
  await db.delete(agentGoalsTable).where(eq(agentGoalsTable.id, id));
  res.sendStatus(204);
});

export default router;
