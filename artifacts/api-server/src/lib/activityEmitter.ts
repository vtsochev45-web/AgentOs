import { EventEmitter } from "events";
import { db } from "@workspace/db";
import { activityLogTable } from "@workspace/db";

export interface ActivityEvent {
  id?: number;
  agentId?: number | null;
  agentName?: string | null;
  actionType: string;
  detail: string;
  timestamp: string;
}

class ActivityEmitter extends EventEmitter {}

export const activityEmitter = new ActivityEmitter();

export function emitActivity(event: ActivityEvent): void {
  activityEmitter.emit("activity", event);
}

export async function persistAndEmitActivity(event: Omit<ActivityEvent, "id">): Promise<void> {
  try {
    const [entry] = await db
      .insert(activityLogTable)
      .values({
        agentId: event.agentId ?? null,
        agentName: event.agentName ?? null,
        actionType: event.actionType,
        detail: event.detail,
      })
      .returning();

    emitActivity({
      id: entry?.id,
      agentId: event.agentId,
      agentName: event.agentName,
      actionType: event.actionType,
      detail: event.detail,
      timestamp: entry?.timestamp?.toISOString() ?? event.timestamp,
    });
  } catch (err: unknown) {
    console.error("[activityEmitter] DB persist failed:", err);
    emitActivity(event);
  }
}

export interface AgentStatusEvent {
  agentId: number;
  status: string;
}

export const agentStatusEmitter = new EventEmitter();

export function emitAgentStatus(event: AgentStatusEvent): void {
  agentStatusEmitter.emit("status", event);
}
