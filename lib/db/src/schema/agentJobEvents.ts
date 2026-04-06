import { pgTable, text, serial, timestamp, integer, jsonb, numeric } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentJobEventsTable = pgTable("agent_job_events", {
  id: serial("id").primaryKey(),
  jobId: text("job_id").notNull(),
  agentId: integer("agent_id").references(() => agentsTable.id, { onDelete: "cascade" }),
  eventType: text("event_type").notNull(),
  eventData: jsonb("event_data"),
  tokenCount: integer("token_count"),
  durationMs: integer("duration_ms"),
  model: text("model"),
  costCents: numeric("cost_cents", { precision: 10, scale: 4 }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentJobEvent = typeof agentJobEventsTable.$inferSelect;
