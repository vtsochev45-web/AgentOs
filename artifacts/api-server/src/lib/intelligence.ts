/**
 * Layer 4: Intelligence — Cost Oracle, Performance Scoring, Anomaly Detection.
 *
 * All derived from the event-sourced agent_job_events table.
 */
import { db } from "@workspace/db";
import { agentJobEventsTable, modelPricingTable, agentsTable } from "@workspace/db";
import { eq, desc, sql, and, gte } from "drizzle-orm";

// ── Cost Oracle ──────────────────────────────────────────────

interface CostEntry {
  agentId: number;
  agentName: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  jobCount: number;
}

export async function getAgentCosts(days = 7): Promise<CostEntry[]> {
  const since = new Date(Date.now() - days * 86400_000);

  const rows = await db.execute(sql`
    SELECT
      e.agent_id,
      a.name as agent_name,
      COALESCE(e.model, 'unknown') as model,
      COALESCE(SUM((e.event_data->>'tokens_in')::int), 0) as tokens_in,
      COALESCE(SUM((e.event_data->>'tokens_out')::int), 0) as tokens_out,
      COUNT(DISTINCT e.job_id) as job_count,
      COALESCE(
        SUM(
          (e.event_data->>'tokens_in')::numeric / 1000 * COALESCE(p.input_per_1k, 0) +
          (e.event_data->>'tokens_out')::numeric / 1000 * COALESCE(p.output_per_1k, 0)
        ), 0
      ) as cost_cents
    FROM agent_job_events e
    LEFT JOIN agents a ON a.id = e.agent_id
    LEFT JOIN model_pricing p ON p.model = e.model
    WHERE e.created_at >= ${since}
      AND e.event_type = 'done'
      AND e.event_data IS NOT NULL
    GROUP BY e.agent_id, a.name, e.model
    ORDER BY cost_cents DESC
  `);

  return (rows.rows as any[]).map(r => ({
    agentId: r.agent_id,
    agentName: r.agent_name || "Unknown",
    model: r.model,
    tokensIn: Number(r.tokens_in),
    tokensOut: Number(r.tokens_out),
    costCents: Number(r.cost_cents),
    jobCount: Number(r.job_count),
  }));
}

export async function getDailyCosts(agentId: number | null, days = 14): Promise<Array<{ date: string; costCents: number; jobs: number }>> {
  const since = new Date(Date.now() - days * 86400_000);
  const agentFilter = agentId ? sql`AND e.agent_id = ${agentId}` : sql``;

  const rows = await db.execute(sql`
    SELECT
      DATE(e.created_at) as day,
      COALESCE(SUM(
        (e.event_data->>'tokens_in')::numeric / 1000 * COALESCE(p.input_per_1k, 0) +
        (e.event_data->>'tokens_out')::numeric / 1000 * COALESCE(p.output_per_1k, 0)
      ), 0) as cost_cents,
      COUNT(DISTINCT e.job_id) as jobs
    FROM agent_job_events e
    LEFT JOIN model_pricing p ON p.model = e.model
    WHERE e.created_at >= ${since}
      AND e.event_type = 'done'
      ${agentFilter}
    GROUP BY DATE(e.created_at)
    ORDER BY day
  `);

  return (rows.rows as any[]).map(r => ({
    date: String(r.day),
    costCents: Number(r.cost_cents),
    jobs: Number(r.jobs),
  }));
}

// ── Performance Scoring ──────────────────────────────────────

export interface AgentPerformance {
  agentId: number;
  agentName: string;
  totalJobs: number;
  avgDurationMs: number;
  avgTokensOut: number;
  errorRate: number;    // 0-1
  toolSuccessRate: number; // 0-1 (approximation)
}

export async function getAgentPerformance(days = 7): Promise<AgentPerformance[]> {
  const since = new Date(Date.now() - days * 86400_000);

  const rows = await db.execute(sql`
    WITH job_stats AS (
      SELECT
        e.agent_id,
        e.job_id,
        MAX(CASE WHEN e.event_type = 'error' THEN 1 ELSE 0 END) as has_error,
        MAX(CASE WHEN e.event_type = 'done' THEN 1 ELSE 0 END) as has_done,
        MAX((e.event_data->>'duration_ms')::int) as duration_ms,
        MAX((e.event_data->>'tokens_out')::int) as tokens_out
      FROM agent_job_events e
      WHERE e.created_at >= ${since}
      GROUP BY e.agent_id, e.job_id
    )
    SELECT
      js.agent_id,
      a.name as agent_name,
      COUNT(*) as total_jobs,
      COALESCE(AVG(js.duration_ms), 0) as avg_duration_ms,
      COALESCE(AVG(js.tokens_out), 0) as avg_tokens_out,
      COALESCE(AVG(js.has_error::numeric), 0) as error_rate
    FROM job_stats js
    LEFT JOIN agents a ON a.id = js.agent_id
    GROUP BY js.agent_id, a.name
    ORDER BY total_jobs DESC
  `);

  return (rows.rows as any[]).map(r => ({
    agentId: r.agent_id,
    agentName: r.agent_name || "Unknown",
    totalJobs: Number(r.total_jobs),
    avgDurationMs: Number(r.avg_duration_ms),
    avgTokensOut: Number(r.avg_tokens_out),
    errorRate: Number(r.error_rate),
    toolSuccessRate: 1 - Number(r.error_rate), // simplified
  }));
}

// ── Anomaly Detection ────────────────────────────────────────

export interface Anomaly {
  agentId: number;
  agentName: string;
  metric: string;
  currentValue: number;
  avgValue: number;
  stddev: number;
  severity: "warning" | "critical";
  timestamp: string;
}

export async function detectAnomalies(days = 7): Promise<Anomaly[]> {
  const since = new Date(Date.now() - days * 86400_000);
  const anomalies: Anomaly[] = [];

  // Get per-agent rolling stats
  const rows = await db.execute(sql`
    WITH job_metrics AS (
      SELECT
        e.agent_id,
        e.job_id,
        MAX((e.event_data->>'duration_ms')::int) as duration_ms,
        MAX((e.event_data->>'tokens_out')::int) as tokens_out,
        MAX(CASE WHEN e.event_type = 'error' THEN 1 ELSE 0 END) as has_error
      FROM agent_job_events e
      WHERE e.created_at >= ${since}
      GROUP BY e.agent_id, e.job_id
    )
    SELECT
      jm.agent_id,
      a.name as agent_name,
      AVG(jm.duration_ms) as avg_duration,
      STDDEV(jm.duration_ms) as std_duration,
      AVG(jm.tokens_out) as avg_tokens,
      STDDEV(jm.tokens_out) as std_tokens,
      AVG(jm.has_error::numeric) as avg_error_rate,
      COUNT(*) as job_count
    FROM job_metrics jm
    LEFT JOIN agents a ON a.id = jm.agent_id
    GROUP BY jm.agent_id, a.name
    HAVING COUNT(*) >= 3
  `);

  // Check recent jobs against rolling averages
  for (const row of rows.rows as any[]) {
    const agentId = row.agent_id;
    const agentName = row.agent_name || "Unknown";
    const avgDur = Number(row.avg_duration) || 0;
    const stdDur = Number(row.std_duration) || 0;
    const avgTok = Number(row.avg_tokens) || 0;
    const stdTok = Number(row.std_tokens) || 0;
    const avgErr = Number(row.avg_error_rate) || 0;

    // Get most recent job for this agent
    const [latest] = await db.execute(sql`
      SELECT
        MAX((e.event_data->>'duration_ms')::int) as duration_ms,
        MAX((e.event_data->>'tokens_out')::int) as tokens_out,
        MAX(CASE WHEN e.event_type = 'error' THEN 1 ELSE 0 END) as has_error
      FROM agent_job_events e
      WHERE e.agent_id = ${agentId}
      ORDER BY e.created_at DESC
      LIMIT 1
    `).then(r => r.rows as any[]);

    if (!latest) continue;

    const dur = Number(latest.duration_ms) || 0;
    const tok = Number(latest.tokens_out) || 0;

    // Duration anomaly: > 2σ above mean
    if (stdDur > 0 && dur > avgDur + 2 * stdDur) {
      anomalies.push({
        agentId, agentName, metric: "duration",
        currentValue: dur, avgValue: avgDur, stddev: stdDur,
        severity: dur > avgDur + 3 * stdDur ? "critical" : "warning",
        timestamp: new Date().toISOString(),
      });
    }

    // Token anomaly: > 2σ above mean
    if (stdTok > 0 && tok > avgTok + 2 * stdTok) {
      anomalies.push({
        agentId, agentName, metric: "token_usage",
        currentValue: tok, avgValue: avgTok, stddev: stdTok,
        severity: tok > avgTok + 3 * stdTok ? "critical" : "warning",
        timestamp: new Date().toISOString(),
      });
    }

    // Error rate anomaly: any error when avg is < 10%
    if (latest.has_error && avgErr < 0.1) {
      anomalies.push({
        agentId, agentName, metric: "error_spike",
        currentValue: 1, avgValue: avgErr, stddev: 0,
        severity: "warning",
        timestamp: new Date().toISOString(),
      });
    }
  }

  return anomalies;
}
