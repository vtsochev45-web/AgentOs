import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const websiteConfigsTable = pgTable("website_configs", {
  id: serial("id").primaryKey(),
  agentId: serial("agent_id").notNull(),
  type: text("type").notNull().default("vps-path"), // "vps-path" | "git"
  repoUrl: text("repo_url"),
  branch: text("branch").notNull().default("main"),
  vpsDirectory: text("vps_directory"),
  siteUrl: text("site_url"),
  buildCommand: text("build_command"),
  deployCommand: text("deploy_command"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWebsiteConfigSchema = createInsertSchema(websiteConfigsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertWebsiteConfig = z.infer<typeof insertWebsiteConfigSchema>;
export type WebsiteConfig = typeof websiteConfigsTable.$inferSelect;
