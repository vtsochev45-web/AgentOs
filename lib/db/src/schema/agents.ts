import { pgTable, text, serial, timestamp, json, integer } from "drizzle-orm/pg-core";
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
  budgetDailyCents: integer("budget_daily_cents"),
  budgetSpentTodayCents: integer("budget_spent_today_cents").default(0),
  budgetResetAt: timestamp("budget_reset_at"),
  evolvedPersona: text("evolved_persona"),
  personaVersion: integer("persona_version").default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAgentSchema = createInsertSchema(agentsTable).omit({ id: true, createdAt: true });
export type InsertAgent = z.infer<typeof insertAgentSchema>;
export type Agent = typeof agentsTable.$inferSelect;
