import { pgTable, text, serial, timestamp, integer, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { agentsTable } from "./agents";

export const agentConversationsTable = pgTable("agent_conversations", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id").notNull().references(() => agentsTable.id, { onDelete: "cascade" }),
  title: text("title").notNull().default("New Conversation"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const agentConversationMessagesTable = pgTable("agent_conversation_messages", {
  id: serial("id").primaryKey(),
  conversationId: integer("conversation_id").notNull().references(() => agentConversationsTable.id, { onDelete: "cascade" }),
  role: text("role").notNull(),
  content: text("content").notNull(),
  sourcesJson: json("sources_json").$type<Array<{title: string; url: string; snippet: string; favicon?: string | null}> | null>(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertAgentConversationSchema = createInsertSchema(agentConversationsTable).omit({ id: true, createdAt: true });
export type InsertAgentConversation = z.infer<typeof insertAgentConversationSchema>;
export type AgentConversation = typeof agentConversationsTable.$inferSelect;

export const insertAgentConversationMessageSchema = createInsertSchema(agentConversationMessagesTable).omit({ id: true, timestamp: true });
export type InsertAgentConversationMessage = z.infer<typeof insertAgentConversationMessageSchema>;
export type AgentConversationMessage = typeof agentConversationMessagesTable.$inferSelect;
