/**
 * Reflection Engine — extracts learnings from completed agent interactions.
 * Stores them as agent memories for future context injection.
 */
import { db } from "@workspace/db";
import { agentMemoryTable, appSettingsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
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
