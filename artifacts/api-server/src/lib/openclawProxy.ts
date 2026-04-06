/**
 * OpenClaw Proxy — routes agent chat through the real OpenClaw backend.
 *
 * Uses non-streaming /api/chat (always clean output) + heartbeat for UX.
 * No debug filtering needed — _parse_result() handles it server-side.
 */
import { db } from "@workspace/db";
import { agentsTable, agentConversationsTable, agentConversationMessagesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOpenclawConfig, openclawHeaders } from "../routes/openclaw";
import { persistAndEmitActivity, emitAgentStatus } from "./activityEmitter";
import { emitJobEvent } from "./agentEventBus";
import { reflectOnInteraction } from "./reflection";

async function setAgentStatus(agentId: number, status: string): Promise<void> {
  await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, agentId));
  emitAgentStatus({ agentId, status });
}

function logActivity(agentId: number, agentName: string, actionType: string, detail: string): void {
  void persistAndEmitActivity({ agentId, agentName, actionType, detail, timestamp: new Date().toISOString() });
}

export async function runOpenclawChat(
  jobId: string,
  agentId: number,
  openclawAgentId: string,
  userMessage: string,
  conversationId: number | null,
): Promise<void> {
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, agentId));
  if (!agent) {
    emitJobEvent(jobId, "error", "Agent not found");
    emitJobEvent(jobId, "done", null);
    return;
  }

  const config = await getOpenclawConfig();
  if (!config) {
    emitJobEvent(jobId, "error", "OpenClaw not configured");
    emitJobEvent(jobId, "done", null);
    return;
  }

  // Create/reuse conversation
  let convId = conversationId;
  if (!convId) {
    const [conv] = await db
      .insert(agentConversationsTable)
      .values({ agentId, title: userMessage.substring(0, 80) })
      .returning();
    convId = conv!.id;
  }

  await db.insert(agentConversationMessagesTable).values({
    conversationId: convId,
    role: "user",
    content: userMessage,
  });

  // Signal start
  await setAgentStatus(agentId, "thinking");
  emitJobEvent(jobId, "conversationId", convId);
  emitJobEvent(jobId, "step", `${agent.name} is thinking...`);
  logActivity(agentId, agent.name, "chat", `Received: "${userMessage.substring(0, 100)}"`);

  // Heartbeat — keeps UI alive during long requests
  let elapsed = 0;
  const heartbeat = setInterval(() => {
    elapsed += 5;
    emitJobEvent(jobId, "step", `Working... (${elapsed}s)`);
  }, 5000);

  // Timeout controller
  const controller = new AbortController();
  const abortTimeout = setTimeout(() => controller.abort(), 300_000); // 5 min

  const headers = openclawHeaders(config.apiKey);

  try {
    const ocRes = await fetch(`${config.url}/api/chat`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        message: userMessage,
        agent: openclawAgentId,
        session_id: `agentos-${agentId}-${Date.now()}`,
      }),
      signal: controller.signal,
    });

    clearInterval(heartbeat);
    clearTimeout(abortTimeout);

    if (!ocRes.ok) {
      const errText = await ocRes.text().catch(() => "Unknown error");
      emitJobEvent(jobId, "error", `Agent error (${ocRes.status})`);
      logActivity(agentId, agent.name, "error", `HTTP ${ocRes.status}: ${errText.substring(0, 100)}`);
      emitJobEvent(jobId, "done", null);
      return;
    }

    // Parse response — /api/chat always returns clean JSON
    let result: { response?: string; meta?: Record<string, unknown>; error?: string };
    try {
      result = await ocRes.json() as typeof result;
    } catch {
      emitJobEvent(jobId, "error", "Received malformed response from agent");
      logActivity(agentId, agent.name, "error", "Non-JSON response from OpenClaw");
      emitJobEvent(jobId, "done", null);
      return;
    }

    if (result.error) {
      emitJobEvent(jobId, "error", "Agent encountered an error");
      logActivity(agentId, agent.name, "error", String(result.error).substring(0, 200));
      emitJobEvent(jobId, "done", null);
      return;
    }

    const answer = result.response || "";
    const meta = (result.meta || {}) as {
      model?: string; duration_ms?: number; tokens_out?: number; tokens_in?: number;
    };

    if (!answer) {
      emitJobEvent(jobId, "error", "Agent returned an empty response");
      logActivity(agentId, agent.name, "error", "Empty response");
      emitJobEvent(jobId, "done", null);
      return;
    }

    // Stream the clean answer in chunks for smooth UI
    await setAgentStatus(agentId, "writing");
    const durationSec = Math.round((meta.duration_ms || 0) / 1000);
    emitJobEvent(jobId, "step", `Done (${meta.model || "agent"}, ${durationSec}s)`);

    const chunks = answer.split(/(?<=\. )|(?<=\n)/);
    for (const chunk of chunks) {
      if (chunk) {
        emitJobEvent(jobId, "content", chunk);
        await new Promise(r => setTimeout(r, 10));
      }
    }

    // Persist to DB
    await db.insert(agentConversationMessagesTable).values({
      conversationId: convId!,
      role: "assistant",
      content: answer,
      sourcesJson: null,
    });

    // Emit enriched completion event (for cost tracking)
    emitJobEvent(jobId, "completion_meta", {
      model: meta.model || "unknown",
      duration_ms: meta.duration_ms || 0,
      tokens_in: meta.tokens_in || 0,
      tokens_out: meta.tokens_out || 0,
    });

    // Log completion summary
    logActivity(agentId, agent.name, "complete",
      `Done in ${durationSec}s via ${meta.model || "agent"} (${meta.tokens_out || 0} tokens)`);

    // Detect delegation mentions for activity visibility
    for (const knownAgent of ["Coder", "DevOps", "Editor", "Researcher", "Social"]) {
      if (answer.includes(knownAgent) && (answer.toLowerCase().includes("spawn") || answer.toLowerCase().includes("delegat"))) {
        logActivity(agentId, knownAgent, "delegated",
          `${agent.name} delegated: "${userMessage.substring(0, 60)}"`);
        break;
      }
    }

    emitJobEvent(jobId, "done", null);

    // Reflection — extract memories async (fire-and-forget)
    reflectOnInteraction(agentId, agent.name, userMessage, answer, jobId).catch(() => {});
  } catch (err) {
    clearInterval(heartbeat);
    clearTimeout(abortTimeout);
    const errMsg = err instanceof Error ? err.message : String(err);
    if (errMsg.includes("abort")) {
      emitJobEvent(jobId, "error", "Request timed out after 5 minutes");
      logActivity(agentId, agent.name, "error", "Timeout after 300s");
    } else {
      emitJobEvent(jobId, "error", "Connection to agent failed");
      logActivity(agentId, agent.name, "error", errMsg.substring(0, 200));
    }
    emitJobEvent(jobId, "done", null);
  } finally {
    clearInterval(heartbeat);
    clearTimeout(abortTimeout);
    await setAgentStatus(agentId, "idle");
  }
}
