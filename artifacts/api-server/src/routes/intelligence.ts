import { Router, type IRouter } from "express";
import { requireApiKey } from "../middlewares/requireApiKey";
import { getAgentCosts, getDailyCosts, getAgentPerformance, detectAnomalies } from "../lib/intelligence";
import { db } from "@workspace/db";
import { modelPricingTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

// Cost Oracle
router.get("/intelligence/costs", requireApiKey, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query.days ?? "7"), 10);
  const costs = await getAgentCosts(days);
  const totalCents = costs.reduce((s, c) => s + c.costCents, 0);
  const totalJobs = costs.reduce((s, c) => s + c.jobCount, 0);
  res.json({ costs, totalCents, totalJobs, days });
});

router.get("/intelligence/costs/daily", requireApiKey, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query.days ?? "14"), 10);
  const agentId = req.query.agentId ? parseInt(String(req.query.agentId), 10) : null;
  const daily = await getDailyCosts(agentId, days);
  res.json(daily);
});

// Performance Scoring
router.get("/intelligence/performance", requireApiKey, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query.days ?? "7"), 10);
  const performance = await getAgentPerformance(days);
  res.json(performance);
});

// Anomaly Detection
router.get("/intelligence/anomalies", requireApiKey, async (req, res): Promise<void> => {
  const days = parseInt(String(req.query.days ?? "7"), 10);
  const anomalies = await detectAnomalies(days);
  res.json(anomalies);
});

// Model Pricing
router.get("/intelligence/pricing", requireApiKey, async (req, res): Promise<void> => {
  const pricing = await db.select().from(modelPricingTable);
  res.json(pricing);
});

router.put("/intelligence/pricing/:model", requireApiKey, async (req, res): Promise<void> => {
  const model = Array.isArray(req.params.model) ? req.params.model[0]! : req.params.model;
  const { inputPer1k, outputPer1k } = req.body as { inputPer1k: number; outputPer1k: number };
  await db.insert(modelPricingTable)
    .values({ model, inputPer1k: String(inputPer1k), outputPer1k: String(outputPer1k) })
    .onConflictDoUpdate({
      target: modelPricingTable.model,
      set: { inputPer1k: String(inputPer1k), outputPer1k: String(outputPer1k) },
    });
  res.json({ model, inputPer1k, outputPer1k });
});

export default router;
