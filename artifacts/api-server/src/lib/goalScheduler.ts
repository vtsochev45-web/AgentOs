/**
 * Goal Scheduler — the heartbeat of AgentOS.
 *
 * Every 60 seconds:
 * 1. Execute pending goal steps
 * 2. Update goal health (momentum, stagnation)
 * 3. Decay memory relevance scores
 * 4. Run idle thinking when nothing to execute
 * 5. Periodically evolve agent personas
 */
import { db } from "@workspace/db";
import { agentGoalsTable, agentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { executeNextStep } from "./goals";
import { updateMemoryRelevance } from "./reflection";
import { updateGoalHealth, idleThink, evolveAgentPersona } from "./autonomy";
import { logger } from "./logger";

let running = false;
let tickCount = 0;

async function tick(): Promise<void> {
  if (running) return;
  running = true;
  tickCount++;

  try {
    let anyExecuted = false;

    // 1. Execute pending goal steps
    const activeGoals = await db.select().from(agentGoalsTable)
      .where(eq(agentGoalsTable.status, "active"));

    for (const goal of activeGoals) {
      try {
        const result = await executeNextStep(goal.id);
        if (result.executed) {
          anyExecuted = true;
          logger.info({ goalId: goal.id, stepId: result.stepId }, "Goal step executed");
        }
      } catch (err) {
        logger.error({ goalId: goal.id, err }, "Goal step error");
      }
    }

    // 2. Update goal health metrics
    await updateGoalHealth().catch(() => {});

    // 3. Decay memory relevance (every 10 ticks = ~10 min)
    if (tickCount % 10 === 0) {
      await updateMemoryRelevance().catch(() => {});
    }

    // 4. Idle thinking when nothing to execute (every 5 ticks = ~5 min)
    if (!anyExecuted && tickCount % 5 === 0) {
      await idleThink().catch(() => {});
    }

    // 5. Evolve agent personas (every 60 ticks = ~1 hour)
    if (tickCount % 60 === 0) {
      const agents = await db.select().from(agentsTable);
      for (const agent of agents) {
        await evolveAgentPersona(agent.id).catch(() => {});
      }
    }
  } catch (err) {
    logger.error({ err }, "Goal scheduler tick error");
  } finally {
    running = false;
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startGoalScheduler(): void {
  if (intervalId) return;
  logger.info("Goal scheduler started (60s interval) — goals, health, memory, idle thinking, persona evolution");
  intervalId = setInterval(tick, 60_000);
  setTimeout(tick, 10_000);
}

export function stopGoalScheduler(): void {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
