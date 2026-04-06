import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const appSettingsTable = pgTable("app_settings", {
  id: serial("id").primaryKey(),
  aiModel: text("ai_model").notNull().default("google/gemini-2.5-flash"),
  openaiApiKey: text("openai_api_key"),
  anthropicApiKey: text("anthropic_api_key"),
  smtpHost: text("smtp_host"),
  smtpPort: integer("smtp_port"),
  smtpUser: text("smtp_user"),
  smtpPassword: text("smtp_password"),
  webhookUrl: text("webhook_url"),
  searchProvider: text("search_provider").notNull().default("duckduckgo"),
  braveApiKey: text("brave_api_key"),
  openclawInstanceUrl: text("openclaw_instance_url"),
  openclawApiKey: text("openclaw_api_key"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertAppSettingsSchema = createInsertSchema(appSettingsTable).omit({ id: true, updatedAt: true });
export type InsertAppSettings = z.infer<typeof insertAppSettingsSchema>;
export type AppSettings = typeof appSettingsTable.$inferSelect;
