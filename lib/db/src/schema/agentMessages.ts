import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

export const agentMessagesTable = pgTable("agent_messages", {
  id: serial("id").primaryKey(),
  fromAgentId: integer("from_agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  toAgentId: integer("to_agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  threadId: text("thread_id"),
  content: text("content").notNull(),
  response: text("response"),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertAgentMessageSchema = createInsertSchema(agentMessagesTable).omit({ id: true, timestamp: true });
export type InsertAgentMessage = z.infer<typeof insertAgentMessageSchema>;
export type AgentMessage = typeof agentMessagesTable.$inferSelect;
