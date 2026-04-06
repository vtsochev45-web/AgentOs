/**
 * Approval Gate — human-in-the-loop for risky agent actions.
 * Auto-approves low risk, queues high risk for human decision.
 */
import { db } from "@workspace/db";
import { approvalRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { persistAndEmitActivity } from "./activityEmitter";

const RISK_LEVELS: Record<string, string> = {
  web_search: "low",
  file_read: "low",
  file_list: "low",
  file_write: "medium",
  code_exec: "medium",
  vps_shell: "high",
  send_email: "high",
  website_deploy: "high",
  website_write: "medium",
  delegate_to_agent: "low",
  compose_pipeline: "medium",
};

/**
 * Check if an action needs approval. Returns null if auto-approved.
 */
export async function checkApproval(
  agentId: number,
  actionType: string,
  description: string,
  context?: Record<string, unknown>,
  goalId?: number,
): Promise<number | null> {
  const riskLevel = RISK_LEVELS[actionType] || "medium";

  // Auto-approve low risk
  if (riskLevel === "low") return null;

  // Create approval request
  const [req] = await db.insert(approvalRequestsTable).values({
    agentId,
    actionType,
    description,
    riskLevel,
    context: context || null,
    goalId: goalId || null,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h expiry
  }).returning();

  void persistAndEmitActivity({
    agentId,
    agentName: null,
    actionType: "approval_needed",
    detail: `[${riskLevel.toUpperCase()}] ${actionType}: ${description.substring(0, 100)}`,
    timestamp: new Date().toISOString(),
  });

  return req!.id;
}

/**
 * Wait for an approval decision (with timeout).
 */
export async function waitForApproval(requestId: number, timeoutMs = 300_000): Promise<"approved" | "rejected" | "expired"> {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const [req] = await db.select().from(approvalRequestsTable).where(eq(approvalRequestsTable.id, requestId));
    if (!req) return "expired";
    if (req.status === "approved") return "approved";
    if (req.status === "rejected") return "rejected";
    if (req.expiresAt && new Date(req.expiresAt) < new Date()) {
      await db.update(approvalRequestsTable).set({ status: "expired" }).where(eq(approvalRequestsTable.id, requestId));
      return "expired";
    }
    await new Promise(r => setTimeout(r, 5000)); // Poll every 5s
  }

  return "expired";
}

/**
 * Decide on an approval request.
 */
export async function decideApproval(requestId: number, decision: "approved" | "rejected", decidedBy: string): Promise<void> {
  await db.update(approvalRequestsTable).set({
    status: decision,
    decidedBy,
    decidedAt: new Date(),
  }).where(eq(approvalRequestsTable.id, requestId));
}
