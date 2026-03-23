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
  db.insert(activityLogTable)
    .values({
      agentId: event.agentId ?? null,
      agentName: event.agentName ?? null,
      actionType: event.actionType,
      detail: event.detail,
    })
    .catch((err: unknown) => {
      console.error("[activityEmitter] DB persist failed:", err);
    });
}

export interface AgentStatusEvent {
  agentId: number;
  status: string;
}

export const agentStatusEmitter = new EventEmitter();

export function emitAgentStatus(event: AgentStatusEvent): void {
  agentStatusEmitter.emit("status", event);
}
