/**
 * Reflection Engine — extracts learnings from completed agent interactions.
 * Stores them as agent memories for future context injection.
 */
import { db } from "@workspace/db";
import { agentMemoryTable, appSettingsTable, agentJobEventsTable } from "@workspace/db";
import { eq, desc, lt, sql } from "drizzle-orm";
import { openai } from "@workspace/integrations-openai-ai-server";

/**
 * After a completed chat, reflect on the interaction and extract memories.
 * Runs async — does not block the response.
 */
export async function reflectOnInteraction(
  agentId: number,
  agentName: string,
  userMessage: string,
  agentResponse: string,
  jobId: string,
): Promise<void> {
  try {
    // Skip reflection for very short interactions
    if (agentResponse.length < 50) return;

    const [settings] = await db.select().from(appSettingsTable).limit(1);
    const model = settings?.aiModel ?? "google/gemini-2.5-flash";

    const reflection = await openai.chat.completions.create({
      model,
      max_completion_tokens: 300,
      messages: [
        {
          role: "system",
          content: `You are a memory extraction system. Given an agent interaction, extract 0-3 key learnings worth remembering for future conversations. Each memory should be a single sentence.

Format each memory on its own line as: category|content
Categories: fact, preference, skill, failure

Only extract genuinely useful information. If nothing is worth remembering, output: none

Examples:
fact|User runs BritFarmers.com and manages multiple AI agents
preference|User prefers concise responses with no trailing summaries
skill|Agent successfully used vps_shell to diagnose disk usage
failure|Delegation to Coder timed out when checking large codebase`,
        },
        {
          role: "user",
          content: `Agent: ${agentName}\nUser asked: ${userMessage.substring(0, 200)}\nAgent responded: ${agentResponse.substring(0, 500)}`,
        },
      ],
    });

    const text = reflection.choices?.[0]?.message?.content || "";
    if (!text || text.trim().toLowerCase() === "none") return;

    const memories = text
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.includes("|"))
      .map((line) => {
        const [category, ...rest] = line.split("|");
        return { category: category!.trim(), content: rest.join("|").trim() };
      })
      .filter((m) => m.content.length > 10 && ["fact", "preference", "skill", "failure"].includes(m.category));

    for (const mem of memories) {
      await db.insert(agentMemoryTable).values({
        agentId,
        category: mem.category,
        content: mem.content,
        sourceJobId: jobId,
      });
    }
  } catch {
    // Reflection is best-effort — never fail the main flow
  }
}

/**
 * Retrieve relevant memories for an agent to inject into system prompt.
 * Returns top 10 by relevance, updates last_accessed_at.
 */
export async function getAgentMemories(agentId: number, limit = 10): Promise<string[]> {
  try {
    const memories = await db
      .select()
      .from(agentMemoryTable)
      .where(eq(agentMemoryTable.agentId, agentId))
      .orderBy(desc(agentMemoryTable.relevanceScore))
      .limit(limit);

    if (memories.length === 0) return [];

    // Update last_accessed_at for retrieved memories
    const ids = memories.map((m) => m.id);
    for (const id of ids) {
      db.update(agentMemoryTable)
        .set({ lastAccessedAt: new Date() })
        .where(eq(agentMemoryTable.id, id))
        .catch(() => {});
    }

    return memories.map((m) => `[${m.category}] ${m.content}`);
  } catch {
    return [];
  }
}

/**
 * Decay relevance scores for memories not accessed in 7+ days.
 * Boost memories from "failure" category (learn from mistakes).
 * Called periodically by the goal scheduler.
 */
export async function updateMemoryRelevance(): Promise<void> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400_000);

    // Decay unused memories
    await db.update(agentMemoryTable)
      .set({ relevanceScore: sql`GREATEST(relevance_score * 0.9, 0.1)` })
      .where(lt(agentMemoryTable.lastAccessedAt, sevenDaysAgo));

    // Boost failure memories (lessons learned are valuable)
    await db.update(agentMemoryTable)
      .set({ relevanceScore: sql`LEAST(relevance_score * 1.1, 2.0)` })
      .where(eq(agentMemoryTable.category, "failure"));
  } catch {
    // Best effort
  }
}

/**
 * Generate strategy hints for an agent based on performance data.
 */
export async function getStrategyHints(agentId: number): Promise<string> {
  try {
    const since = new Date(Date.now() - 7 * 86400_000);
    const rows = await db.execute(sql`
      SELECT
        COUNT(DISTINCT job_id) as total_jobs,
        AVG((event_data->>'duration_ms')::int) as avg_duration,
        AVG((event_data->>'tokens_out')::int) as avg_tokens,
        SUM(CASE WHEN event_type = 'error' THEN 1 ELSE 0 END) as errors
      FROM agent_job_events
      WHERE agent_id = ${agentId}
        AND created_at >= ${since}
    `);

    const r = (rows.rows as any[])[0];
    if (!r || !r.total_jobs || Number(r.total_jobs) < 2) return "";

    const avgSec = (Number(r.avg_duration) / 1000).toFixed(1);
    const errorPct = Math.round((Number(r.errors) / Number(r.total_jobs)) * 100);

    return `\nYour recent performance (7d): ${r.total_jobs} tasks, avg ${avgSec}s, ${errorPct}% errors. Be efficient and concise.`;
  } catch {
    return "";
  }
}
