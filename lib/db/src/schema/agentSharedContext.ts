import { pgTable, text, serial, timestamp, integer, jsonb, unique } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentSharedContextTable = pgTable("agent_shared_context", {
  id: serial("id").primaryKey(),
  namespace: text("namespace").notNull(),
  key: text("key").notNull(),
  value: jsonb("value").notNull(),
  setByAgentId: integer("set_by_agent_id").references(() => agentsTable.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [unique().on(t.namespace, t.key)]);

export type AgentSharedContext = typeof agentSharedContextTable.$inferSelect;
