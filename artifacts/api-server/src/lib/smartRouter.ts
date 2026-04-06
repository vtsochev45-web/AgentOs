/**
 * Smart Router — auto-selects optimal model and agent based on performance data.
 * Uses intelligence layer metrics to make cost/quality trade-offs.
 */
import { db } from "@workspace/db";
import { agentJobEventsTable, appSettingsTable, agentsTable, modelPricingTable } from "@workspace/db";
import { eq, sql, gte, desc } from "drizzle-orm";
import { logger } from "./logger";

interface RouteDecision {
  model: string | null;   // null = use default
  reason: string;
}

/**
 * Select optimal model for a task based on complexity, cost, and performance.
 */
export async function selectModel(agentId: number, message: string): Promise<RouteDecision> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  const defaultModel = settings?.aiModel ?? "google/gemini-2.5-flash";

  // Check if auto-routing is enabled (via costBudgetDaily field presence)
  const budgetDaily = Number((settings as any)?.costBudgetDaily) || 0;
  if (!budgetDaily) return { model: null, reason: "Auto-routing disabled (no budget set)" };

  // Estimate complexity from message length and keywords
  const complexity = estimateComplexity(message);

  // Check today's spend
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const spentRows = await db.execute(sql`
    SELECT COALESCE(SUM(
      (event_data->>'tokens_in')::numeric / 1000 * COALESCE(p.input_per_1k, 0) +
      (event_data->>'tokens_out')::numeric / 1000 * COALESCE(p.output_per_1k, 0)
    ), 0) as spent
    FROM agent_job_events e
    LEFT JOIN model_pricing p ON p.model = e.model
    WHERE e.created_at >= ${today}
      AND e.event_type = 'completion_meta'
  `);
  const spentCents = Number((spentRows.rows as any[])[0]?.spent || 0);
  const budgetRemaining = budgetDaily - spentCents;

  if (budgetRemaining <= 0) {
    return { model: "google/gemini-2.5-flash", reason: `Budget exhausted ($${(spentCents/100).toFixed(2)} spent today)` };
  }

  // Route based on complexity
  if (complexity === "simple") {
    return { model: "google/gemini-2.5-flash", reason: `Simple query, using cheap model (budget: $${(budgetRemaining/100).toFixed(2)} left)` };
  }

  if (complexity === "complex") {
    // Check if we can afford a powerful model
    if (budgetRemaining > 50) { // >$0.50 remaining
      return { model: null, reason: `Complex query, using configured model (budget: $${(budgetRemaining/100).toFixed(2)} left)` };
    }
    return { model: "google/gemini-2.5-flash", reason: `Complex but budget low ($${(budgetRemaining/100).toFixed(2)} left), downgrading` };
  }

  return { model: null, reason: "Standard routing" };
}

/**
 * Select best agent for a task based on specialization and performance.
 */
export async function selectAgent(task: string): Promise<{ agentId: number; agentName: string; reason: string } | null> {
  const agents = await db.select().from(agentsTable);
  if (agents.length === 0) return null;

  // Score each agent by keyword match on persona
  const taskLower = task.toLowerCase();
  const scores: Array<{ agent: typeof agents[0]; score: number }> = [];

  for (const agent of agents) {
    let score = 0;
    const persona = (agent.persona || "").toLowerCase();

    // Keyword matching
    const keywords: Record<string, string[]> = {
      code: ["code", "programming", "software", "debug", "implement", "build", "develop", "api", "function"],
      research: ["research", "find", "investigate", "look up", "search", "discover", "analyze"],
      devops: ["server", "deploy", "monitor", "uptime", "disk", "cpu", "process", "infrastructure", "ssh"],
      content: ["write", "article", "blog", "content", "seo", "publish", "editorial"],
      social: ["social", "twitter", "facebook", "post", "share", "newsletter"],
    };

    for (const [category, words] of Object.entries(keywords)) {
      const taskMatch = words.some(w => taskLower.includes(w));
      const personaMatch = words.some(w => persona.includes(w));
      if (taskMatch && personaMatch) score += 10;
    }

    scores.push({ agent, score });
  }

  // Sort by score, pick best
  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  if (!best || best.score === 0) return null;

  return {
    agentId: best.agent.id,
    agentName: best.agent.name,
    reason: `Best match by specialization (score: ${best.score})`,
  };
}

function estimateComplexity(message: string): "simple" | "standard" | "complex" {
  const len = message.length;
  const lower = message.toLowerCase();

  // Simple: short questions, greetings, status checks
  if (len < 50) return "simple";
  if (/^(hi|hello|hey|ping|status|what time|what day)/.test(lower)) return "simple";

  // Complex: code review, multi-step tasks, research, analysis
  if (len > 300) return "complex";
  if (/\b(review|audit|analyze|investigate|implement|refactor|deploy|pipeline|research)\b/.test(lower)) return "complex";
  if (lower.includes("ask") && lower.includes("agent")) return "complex"; // Delegation

  return "standard";
}
