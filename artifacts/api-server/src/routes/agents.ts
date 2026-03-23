import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import {
  agentsTable,
  agentConversationsTable,
  agentConversationMessagesTable,
  agentMessagesTable,
  activityLogTable,
} from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { runAgentChat } from "../lib/agentRunner";
import { emitActivity, agentStatusEmitter } from "../lib/activityEmitter";

const router: IRouter = Router();

router.get("/agents", async (req, res): Promise<void> => {
  const agents = await db.select().from(agentsTable).orderBy(desc(agentsTable.createdAt));
  res.json(agents);
});

router.post("/agents", async (req, res): Promise<void> => {
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

router.get("/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [agent] = await db.select().from(agentsTable).where(eq(agentsTable.id, id));
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.patch("/agents/:id", async (req, res): Promise<void> => {
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

router.delete("/agents/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [agent] = await db.delete(agentsTable).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.sendStatus(204);
});

router.patch("/agents/:id/status", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { status } = req.body as { status: string };
  const [agent] = await db.update(agentsTable).set({ status, lastActiveAt: new Date() }).where(eq(agentsTable.id, id)).returning();
  if (!agent) { res.status(404).json({ error: "Agent not found" }); return; }
  res.json(agent);
});

router.get("/agents/stream", async (req, res): Promise<void> => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write("data: {\"type\":\"connected\"}\n\n");

  const onStatus = (event: { agentId: number; status: string }) => {
    res.write(`data: ${JSON.stringify({ type: "status", ...event })}\n\n`);
  };

  agentStatusEmitter.on("status", onStatus);
  req.on("close", () => agentStatusEmitter.off("status", onStatus));
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

router.delete("/conversations/:id", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const [conv] = await db.delete(agentConversationsTable).where(eq(agentConversationsTable.id, id)).returning();
  if (!conv) { res.status(404).json({ error: "Conversation not found" }); return; }
  res.sendStatus(204);
});

// Agent chat - SSE streaming
router.post("/agents/:id/chat", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { content, conversationId } = req.body as { content: string; conversationId?: number };

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  await runAgentChat(id, content, conversationId ?? null, res);
});

// Agent-to-agent messages
router.get("/agents/:id/messages", async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const msgs = await db
    .select()
    .from(agentMessagesTable)
    .where(eq(agentMessagesTable.toAgentId, id))
    .orderBy(desc(agentMessagesTable.timestamp))
    .limit(50);
  res.json(msgs);
});

router.post("/agents/:id/messages", async (req, res): Promise<void> => {
  const fromAgentId = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { toAgentId, content, threadId } = req.body as { toAgentId: number; content: string; threadId?: string };

  const [msg] = await db
    .insert(agentMessagesTable)
    .values({ fromAgentId, toAgentId, content, threadId: threadId ?? null })
    .returning();

  const [fromAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, fromAgentId));
  const [toAgent] = await db.select().from(agentsTable).where(eq(agentsTable.id, toAgentId));

  emitActivity({
    agentId: fromAgentId,
    agentName: fromAgent?.name ?? "Unknown",
    actionType: "agent_message",
    detail: `Delegated to ${toAgent?.name ?? "Agent"}: ${content.substring(0, 100)}`,
    timestamp: new Date().toISOString(),
  });

  res.status(201).json(msg);
});

export default router;
