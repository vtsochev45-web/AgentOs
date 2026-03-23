import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  agentsTable,
  agentConversationsTable,
  agentConversationMessagesTable,
  agentMessagesTable,
  agentFilesTable,
  activityLogTable,
} from "@workspace/db";
import { eq, desc, or } from "drizzle-orm";
import { runAgentChat, runAgentChatInternal } from "../lib/agentRunner";
import { persistAndEmitActivity, agentStatusEmitter, emitAgentStatus } from "../lib/activityEmitter";
import { requireApiKey } from "../middlewares/requireApiKey";

const router: IRouter = Router();

router.get("/agents", async (req, res): Promise<void> => {
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

router.get("/agents/stream", async (req, res): Promise<void> => {
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

router.get("/agents/:id", async (req, res): Promise<void> => {
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
router.get("/agents/:id/conversations", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const convs = await db
    .select()
    .from(agentConversationsTable)
    .where(eq(agentConversationsTable.agentId, id))
    .orderBy(desc(agentConversationsTable.createdAt));
  res.json(convs);
});

router.get("/conversations/:id", async (req, res): Promise<void> => {
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

// Agent chat - SSE streaming
router.post("/agents/:id/chat", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { content, conversationId } = req.body as { content: string; conversationId?: number };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  await runAgentChat(id, content, conversationId ?? null, res);
});

// Agent-to-agent messages (both sent and received for full collaboration traceability)
router.get("/agents/:id/messages", async (req, res): Promise<void> => {
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
router.get("/network/edges", async (req, res): Promise<void> => {
  const msgs = await db
    .select()
    .from(agentMessagesTable)
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(200);

  const edgeMap = new Map<string, { source: number; target: number; count: number }>();
  for (const msg of msgs) {
    const key = `${msg.fromAgentId}-${msg.toAgentId}`;
    const existing = edgeMap.get(key);
    if (existing) {
      existing.count++;
    } else {
      edgeMap.set(key, { source: msg.fromAgentId, target: msg.toAgentId, count: 1 });
    }
  }

  res.json(Array.from(edgeMap.values()));
});

router.get("/agents/:id/files", async (req, res): Promise<void> => {
  const agentId = parseInt(req.params.id, 10);
  if (isNaN(agentId)) { res.status(400).json({ error: "Invalid agent id" }); return; }
  const files = await db
    .select()
    .from(agentFilesTable)
    .where(eq(agentFilesTable.agentId, agentId))
    .orderBy(desc(agentFilesTable.updatedAt));
  res.json(files);
});

export default router;
