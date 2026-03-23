import { pgTable, text, serial, timestamp, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vpsConfigTable = pgTable("vps_config", {
  id: serial("id").primaryKey(),
  label: text("label").notNull().default("My VPS"),
  host: text("host").notNull(),
  port: integer("port").notNull().default(22),
  username: text("username").notNull(),
  authType: text("auth_type").notNull().default("password"),
  encryptedCredential: text("encrypted_credential"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertVpsConfigSchema = createInsertSchema(vpsConfigTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertVpsConfig = z.infer<typeof insertVpsConfigSchema>;
export type VpsConfig = typeof vpsConfigTable.$inferSelect;
