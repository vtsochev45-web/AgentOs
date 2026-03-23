import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { agentsTable } from "./agents";

export const agentFilesTable = pgTable("agent_files", {
  id: serial("id").primaryKey(),
  agentId: integer("agent_id")
    .notNull()
    .references(() => agentsTable.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  content: text("content").notNull().default(""),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  agentPathUniq: unique("agent_files_agent_path_uniq").on(table.agentId, table.path),
}));

export type AgentFile = typeof agentFilesTable.$inferSelect;
