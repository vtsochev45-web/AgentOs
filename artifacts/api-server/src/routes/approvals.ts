import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { approvalRequestsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { requireApiKey } from "../middlewares/requireApiKey";
import { decideApproval } from "../lib/approvalGate";

const router: IRouter = Router();

router.get("/approvals", requireApiKey, async (req, res): Promise<void> => {
  const status = req.query.status ? String(req.query.status) : undefined;
  const approvals = status
    ? await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.status, status)).orderBy(desc(approvalRequestsTable.createdAt))
    : await db.select().from(approvalRequestsTable).orderBy(desc(approvalRequestsTable.createdAt)).limit(50);
  res.json(approvals);
});

router.post("/approvals/:id/decide", requireApiKey, async (req, res): Promise<void> => {
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0]! : req.params.id, 10);
  const { decision, decidedBy } = req.body as { decision: "approved" | "rejected"; decidedBy?: string };
  if (!decision || !["approved", "rejected"].includes(decision)) {
    res.status(400).json({ error: "decision must be 'approved' or 'rejected'" });
    return;
  }
  await decideApproval(id, decision, decidedBy || "user");
  const [updated] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, id));
  res.json(updated);
});

router.get("/approvals/stats", requireApiKey, async (req, res): Promise<void> => {
  const all = await db.select().from(approvalRequestsTable);
  const stats = {
    pending: all.filter(a => a.status === "pending").length,
    approved: all.filter(a => a.status === "approved").length,
    rejected: all.filter(a => a.status === "rejected").length,
    expired: all.filter(a => a.status === "expired").length,
  };
  res.json(stats);
});

export default router;
