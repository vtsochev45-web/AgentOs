import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  agentsTable,
  agentConversationsTable,
  agentConversationMessagesTable,
  agentMessagesTable,
  agentFilesTable,
  activityLogTable,
  agentJobEventsTable,
  agentMemoryTable,
} from "@workspace/db";
import { eq, desc, or } from "drizzle-orm";
import { runAgentChat, runAgentChatInternal } from "../lib/agentRunner";
import { runOpenclawChat } from "../lib/openclawProxy";
import { createJob, subscribeJob, getJobEvents, isJobDone, getActiveJob, hasActiveJob } from "../lib/agentEventBus";
import { persistAndEmitActivity, agentStatusEmitter, emitAgentStatus } from "../lib/activityEmitter";
import { requireApiKey } from "../middlewares/requireApiKey";

const router: IRouter = Router();

router.get("/agents", requireApiKey, async (req, res): Promise<void> => {
  const agents = await db.select().from(agentsTable).orderBy(desc(agentsTable.createdAt));
  res.json(agents);
});

router.post("/agents", requireApiKey, async (req, res): Promise<void> => {
  const { name, persona, toolsEnabled } = req.body as { name: string; persona: string; toolsEnabled?: string[] };
  if (!name || !persona) {
    res.status(400).json({ error: "name and persona are required" });
    return;
  }
  const [agent] = await db
    .insert(agentsTable)
    .values({ name, persona, toolsEnabled: toolsEnabled ?? ["web_search", "file_read", "file_write", "code_exec"] })
    .returning();
  res.status(201).json(agent);
});

router.get("/agents/stream", requireApiKey, async (req, res): Promise<void> => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write("data: {\"type\":\"connected\"}\n\n");

  const onStatus = (event: { agentId: number; status: string }) => {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ type: "status", ...event })}\n\n`);
    }
  };

  agentStatusEmitter.on("status", onStatus);
  req.on("close", () => agentStatusEmitter.off("status", onStatus));
});

router.get("/agents/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.patch("/agents/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { name, persona, toolsEnabled } = req.body as { name?: string; persona?: string; toolsEnabled?: string[] };
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (persona !== undefined) updates.persona = persona;
  if (toolsEnabled !== undefined) updates.toolsEnabled = toolsEnabled;

  const [agent] = await db.update(agentsTable).set(updates).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.delete("/agents/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [agent] = await db.delete(agentsTable).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.sendStatus(204);
});

router.patch("/agents/:id/status", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { status } = req.body as { status: string };
  const [agent] = await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  emitAgentStatus({ agentId: id, status });
  res.json(agent);
});

// Agent conversations
router.get("/agents/:id/conversations", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const convs = await db
    .select()
    .from(agentConversationsTable)
    .where(eq(agentConversationsTable.agentId, id))
    .orderBy(desc(agentConversationsTable.createdAt));
  res.json(convs);
});

router.get("/conversations/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [conv] = await db.select().from(agentConversationsTable).where(eq(agentConversationsTable.id, id));
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  const messages = await db
    .select()
    .from(agentConversationMessagesTable)
    .where(eq(agentConversationMessagesTable.conversationId, id))
    .orderBy(agentConversationMessagesTable.timestamp);
  res.json({ ...conv, messages });
});

router.delete("/conversations/:id", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [conv] = await db.delete(agentConversationsTable).where(eq(agentConversationsTable.id, id)).returning();
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.sendStatus(204);
});

// Agent chat - fire-and-forget via event bus, returns jobId
router.post("/agents/:id/chat", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { content, conversationId } = req.body as { content: string; conversationId?: number };

  if (hasActiveJob(id)) {
    res.status(409).json({ error: "Agent is already processing a request" });
    return;
  }

  const jobId = createJob(id);

  // Start agent work in background (not tied to this response)
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (agent?.openclawAgentId) {
    runOpenclawChat(jobId, id, agent.openclawAgentId, content, conversationId ?? null).catch(console.error);
  } else {
    runAgentChat(jobId, id, content, conversationId ?? null).catch(console.error);
  }

  // Stream events to client from the bus
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Replay any events that already fired
  for (const evt of getJobEvents(jobId)) {
    res.write(`data: ${JSON.stringify({ type: evt.type, data: evt.data })}\n\n`);
  }

  if (isJobDone(jobId)) {
    res.end();
    return;
  }

  // Subscribe to new events
  const unsub = subscribeJob(jobId, (evt) => {
    try {
      res.write(`data: ${JSON.stringify({ type: evt.type, data: evt.data })}\n\n`);
    } catch {
      // Client disconnected — that's fine, agent keeps working
    }
    if (evt.type === "done" || evt.type === "error") {
      try { res.end(); } catch {}
      unsub();
    }
  });

  // If client disconnects, just unsubscribe (agent keeps working)
  res.on("close", () => unsub());
});

// Reconnect to an active agent job (for tab switching)
router.get("/agents/:id/job", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const jobId = getActiveJob(id);

  if (!jobId) {
    res.json({ active: false });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Replay all events so far
  for (const evt of getJobEvents(jobId)) {
    res.write(`data: ${JSON.stringify({ type: evt.type, data: evt.data })}\n\n`);
  }

  if (isJobDone(jobId)) {
    res.end();
    return;
  }

  const unsub = subscribeJob(jobId, (evt) => {
    try {
      res.write(`data: ${JSON.stringify({ type: evt.type, data: evt.data })}\n\n`);
    } catch {}
    if (evt.type === "done" || evt.type === "error") {
      try { res.end(); } catch {}
      unsub();
    }
  });

  res.on("close", () => unsub());
});

// Agent-to-agent messages (both sent and received for full collaboration traceability)
router.get("/agents/:id/messages", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const msgs = await db
    .select()
    .from(agentMessagesTable)
    .where(or(eq(agentMessagesTable.toAgentId, id), eq(agentMessagesTable.fromAgentId, id)))
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(50);
  res.json(msgs);
});

router.post("/agents/:id/messages", requireApiKey, async (req, res): Promise<void> => {
  const fromAgentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { toAgentId, content, threadId } = req.body as { toAgentId: number; content: string; threadId?: string };

  const [msg] = await db
    .insert(agentMessagesTable)
    .values({ fromAgentId, toAgentId, content, threadId: threadId ?? null })
    .returning();

  const [fromAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, fromAgentId));
  const [toAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, toAgentId));

  void persistAndEmitActivity({
    agentId: fromAgentId,
    agentName: fromAgent?.name ?? "Unknown",
    actionType: "agent_message",
    detail: `Delegated to ${toAgent?.name ?? "Agent"}: ${content.substring(0, 100)}`,
    timestamp: new Date().toISOString(),
  });

  res.status(201).json(msg);

  if (toAgent) {
    const delegationPrompt = `[DELEGATION from ${fromAgent?.name ?? "Agent"} #${fromAgentId}]: ${content}`;
    setImmediate(async () => {
      try {
        await runAgentChatInternal(toAgent.id, delegationPrompt, null, msg.id);
      } catch (err) {
        // Delegation error is non-fatal — log and continue
        console.error(`[delegation] Failed for agent ${toAgent.id}:`, err);
      }
    });
  }
});

// Network edges — real agent message pairs for graph visualization
router.get("/network/edges", requireApiKey, async (req, res): Promise<void> => {
  const edgeMap = new Map<string, { source: number; target: number; count: number }>();

  // Edges from delegation messages
  const msgs = await db
    .select()
    .from(agentMessagesTable)
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(200);

  for (const msg of msgs) {
    const key = `${msg.fromAgentId}-${msg.toAgentId}`;
    const existing = edgeMap.get(key);
    if (existing) existing.count++;
    else edgeMap.set(key, { source: msg.fromAgentId, target: msg.toAgentId, count: 1 });
  }

  // Edges from activity log (agent interactions via delegation mentions)
  const activities = await db.select().from(activityLogTable)
    .where(eq(activityLogTable.actionType, "delegated"))
    .orderBy(desc(activityLogTable.timestamp))
    .limit(100);

  // Get agent name → id map
  const allAgents = await db.select().from(agentsTable);
  const nameToId = new Map(allAgents.map(a => [a.name.toLowerCase(), a.id]));

  for (const act of activities) {
    if (!act.agentId || !act.agentName) continue;
    const targetId = nameToId.get(act.agentName.toLowerCase());
    if (targetId && targetId !== act.agentId) {
      const key = `${act.agentId}-${targetId}`;
      const existing = edgeMap.get(key);
      if (existing) existing.count++;
      else edgeMap.set(key, { source: act.agentId, target: targetId, count: 1 });
    }
  }

  // Also create edges from shared goal execution (agents working on same goals)
  const { agentGoalsTable } = await import("@workspace/db");
  const goals = await db.select().from(agentGoalsTable).limit(50);
  const goalAgents = goals.map(g => g.agentId);
  // Connect agents that share goals (lightweight mesh)
  for (let i = 0; i < goalAgents.length; i++) {
    for (let j = i + 1; j < goalAgents.length; j++) {
      if (goalAgents[i] !== goalAgents[j]) {
        const key = `${goalAgents[i]}-${goalAgents[j]}`;
        if (!edgeMap.has(key)) {
          edgeMap.set(key, { source: goalAgents[i]!, target: goalAgents[j]!, count: 1 });
        }
      }
    }
  }

  res.json(Array.from(edgeMap.values()));
});

router.get("/agents/:id/files", requireApiKey, async (req, res): Promise<void> => {
  const rawId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const agentId = parseInt(rawId, 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const files = await db
    .select()
    .from(agentFilesTable)
    .where(eq(agentFilesTable.agentId, agentId))
    .orderBy(desc(agentFilesTable.updatedAt));
  res.json(files);
});

// Agent memories
router.get("/agents/:id/memories", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const memories = await db.select().from(agentMemoryTable)
    .where(eq(agentMemoryTable.agentId, id))
    .orderBy(desc(agentMemoryTable.relevanceScore))
    .limit(50);
  res.json(memories);
});

router.delete("/agents/:id/memories/:memId", requireApiKey, async (req, res): Promise<void> => {
  const memId = parseInt(Array.isArray(req.params.memId) ? req.params.memId[0]! : req.params.memId, 10);
  await db.delete(agentMemoryTable).where(eq(agentMemoryTable.id, memId));
  res.sendStatus(204);
});

// Job event history (for time-travel debugging)
router.get("/agents/:id/job-events", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const limit = parseInt(String(req.query.limit ?? "100"), 10);
  const events = await db.select().from(agentJobEventsTable)
    .where(eq(agentJobEventsTable.agentId, id))
    .orderBy(desc(agentJobEventsTable.createdAt))
    .limit(limit);
  res.json(events);
});

router.get("/job-events/:jobId", requireApiKey, async (req, res): Promise<void> => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0]! : req.params.jobId;
  const events = await db.select().from(agentJobEventsTable)
    .where(eq(agentJobEventsTable.jobId, jobId))
    .orderBy(agentJobEventsTable.createdAt);
  res.json(events);
});

// Agent budget management
router.patch("/agents/:id/budget", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { budgetDailyCents } = req.body as { budgetDailyCents: number | null };
  const [agent] = await db.update(agentsTable)
    .set({ budgetDailyCents: budgetDailyCents ?? null })
    .where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

// Agent evolved persona
router.get("/agents/:id/persona", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json({
    original: agent.persona,
    evolved: (agent as any).evolvedPersona || null,
    version: (agent as any).personaVersion || 0,
  });
});

export default router;
