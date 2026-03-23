import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { activityEmitter } from "../lib/activityEmitter";

const router: IRouter = Router();

router.get("/activity", async (req, res): Promise<void> => {
  const limit = parseInt(String(req.query.limit ?? "50"), 10);
  const agentId = req.query.agentId ? parseInt(String(req.query.agentId), 10) : null;

  let query = db.select().from(activityLogTable);
  if (agentId) {
    const entries = await db
      .select()
      .from(activityLogTable)
      .where(eq(activityLogTable.agentId, agentId))
      .orderBy(desc(activityLogTable.timestamp))
      .limit(limit);
    res.json(entries);
    return;
  }

  const entries = await db
    .select()
    .from(activityLogTable)
    .orderBy(desc(activityLogTable.timestamp))
    .limit(limit);
  res.json(entries);
});

router.get("/activity/stream", async (req, res): Promise<void> => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.write("data: {\"type\":\"connected\"}\n\n");

  const onActivity = (event: Record<string, unknown>) => {
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  };

  activityEmitter.on("activity", onActivity);
  req.on("close", () => activityEmitter.off("activity", onActivity));
});

export default router;
