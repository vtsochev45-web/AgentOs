/**
 * Goal Scheduler — background loop that executes goal steps.
 * Runs every 60 seconds, picks up active goals, executes next pending step.
 */
import { db } from "@workspace/db";
import { agentGoalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeNextStep } from "./goals";
import { updateMemoryRelevance } from "./reflection";
import { logger } from "./logger";

let running = false;

async function tick(): Promise<void> {
  if (running) return; // Prevent overlapping ticks
  running = true;

  try {
    const activeGoals = await db.select().from(agentGoalsTable)
      .where(eq(agentGoalsTable.status, "active"));

    for (const goal of activeGoals) {
      try {
        const result = await executeNextStep(goal.id);
        if (result.executed) {
          logger.info({ goalId: goal.id, stepId: result.stepId }, "Goal step executed");
        }
        // If agent is busy, skip to next goal — will retry next tick
      } catch (err) {
        logger.error({ goalId: goal.id, err }, "Goal step execution error");
      }
    }
    // Update memory relevance scores (every tick)
    await updateMemoryRelevance().catch(() => {});
  } catch (err) {
    logger.error({ err }, "Goal scheduler tick error");
  } finally {
    running = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startGoalScheduler(): void {
  if (intervalId) return;
  logger.info("Goal scheduler started (60s interval)");
  intervalId = setInterval(tick, 60_000);
  // Run first tick after 10s (let server fully boot)
  setTimeout(tick, 10_000);
}

export function stopGoalScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    logger.info("Goal scheduler stopped");
  }
}
