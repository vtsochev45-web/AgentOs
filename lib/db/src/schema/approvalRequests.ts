import { pgTable, text, serial, timestamp, integer, jsonb } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";
import { agentGoalsTable } from "./agentGoals";

export const approvalRequestsTable = pgTable("approval_requests", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").references(() => agentsTable.id),
  actionType: text("action_type").notNull(),
  description: text("description").notNull(),
  riskLevel: text("risk_level").default("medium"),
  status: text("status").default("pending"),
  decidedBy: text("decided_by"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  context: jsonb("context"),
  goalId: integer("goal_id").references(() => agentGoalsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
});

export type ApprovalRequest = typeof approvalRequestsTable.$inferSelect;
