import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const activityLogTable = pgTable("activity_log", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id"),
  agentName: text("agent_name"),
  actionType: text("action_type").notNull(),
  detail: text("detail").notNull(),
  timestamp: timestamp("timestamp").notNull().defaultNow(),
});

export const insertActivityLogSchema = createInsertSchema(activityLogTable).omit({ id: true, timestamp: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLogTable.$inferSelect;
