import { pgTable, text, serial, timestamp, integer, jsonb, real } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentGoalsTable = pgTable("agent_goals", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  description: text("description"),
  successCriteria: text("success_criteria"),
  status: text("status").notNull().default("active"),
  priority: text("priority").default("normal"),
  progress: integer("progress").default(0),
  openclawTaskIds: jsonb("openclaw_task_ids").$type<string[]>().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deadline: timestamp("deadline", { withTimezone: true }),
  momentum: real("momentum").default(0),
  stagnantTicks: integer("stagnant_ticks").default(0),
  lastStepAt: timestamp("last_step_at", { withTimezone: true }),
});

export type AgentGoal = typeof agentGoalsTable.$inferSelect;
