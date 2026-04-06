import { pgTable, text, serial, timestamp, json } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const agentsTable = pgTable("agents", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  persona: text("persona").notNull(),
  toolsEnabled: json("tools_enabled").$type<string[]>().notNull().default([]),
  status: text("status").notNull().default("idle"),
  lastActiveAt: timestamp("last_active_at"),
  openclawAgentId: text("openclaw_agent_id"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
