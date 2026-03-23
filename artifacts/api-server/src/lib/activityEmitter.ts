import { EventEmitter } from "events";

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

export interface AgentStatusEvent {
  agentId: number;
  status: string;
}

export const agentStatusEmitter = new EventEmitter();

export function emitAgentStatus(event: AgentStatusEvent): void {
  agentStatusEmitter.emit("status", event);
}
