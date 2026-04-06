import { pgTable, text, numeric } from "drizzle-orm/pg-core";

export const modelPricingTable = pgTable("model_pricing", {
  model: text("model").primaryKey(),
  inputPer1k: numeric("input_per_1k", { precision: 10, scale: 6 }).notNull().default("0"),
  outputPer1k: numeric("output_per_1k", { precision: 10, scale: 6 }).notNull().default("0"),
});

export type ModelPricing = typeof modelPricingTable.$inferSelect;
