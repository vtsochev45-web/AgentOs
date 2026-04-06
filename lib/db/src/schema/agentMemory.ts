import { pgTable, text, serial, timestamp, integer, real } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentMemoryTable = pgTable("agent_memory", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  category: text("category").notNull(), // 'fact', 'preference', 'skill', 'failure'
  content: text("content").notNull(),
  sourceJobId: text("source_job_id"),
  relevanceScore: real("relevance_score").notNull().default(1.0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastAccessedAt: timestamp("last_accessed_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AgentMemory = typeof agentMemoryTable.$inferSelect;
