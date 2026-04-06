import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { agentGoalsTable } from "./agentGoals";

export const agentGoalStepsTable = pgTable("agent_goal_steps", {
  id: serial("id").primaryKey(),
  goalId: integer("goal_id").notNull().references(() => agentGoalsTable.id, { onDelete: "cascade" }),
  stepOrder: integer("step_order").notNull(),
  description: text("description").notNull(),
  status: text("status").default("pending"),
  result: text("result"),
  openclawTaskId: text("openclaw_task_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export type AgentGoalStep = typeof agentGoalStepsTable.$inferSelect;
