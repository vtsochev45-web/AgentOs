import { useMemo } from "react";
import type { ActivityEvent } from "./use-sse";

export interface TaskGroup {
  id: string;
  agentName: string;
  query: string;
  timestamp: string;
  events: ActivityEvent[];
  status: "running" | "complete" | "error";
}

export function groupActivities(activities: ActivityEvent[]): TaskGroup[] {
  const sorted = [...activities].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  const groups: TaskGroup[] = [];
  let current: TaskGroup | null = null;

  for (const evt of sorted) {
    if (evt.actionType === "chat" && evt.detail?.startsWith("Received:")) {
      current = {
        id: `${evt.agentName}-${evt.timestamp}`,
        agentName: evt.agentName || "Agent",
        query: evt.detail.replace(/^Received:\s*"?|"?\s*$/g, ""),
        timestamp: evt.timestamp || "",
        events: [evt],
        status: "running",
      };
      groups.push(current);
    } else if (current && (evt.agentName === current.agentName || current.status === "running")) {
      current.events.push(evt);
      if (evt.actionType === "complete") current.status = "complete";
      if (evt.actionType === "error") current.status = "error";
    } else if (current) {
      current.events.push(evt);
      if (evt.actionType === "complete") current.status = "complete";
    } else {
      groups.push({
        id: `${evt.agentName}-${evt.timestamp}-${evt.id}`,
        agentName: evt.agentName || "System",
        query: evt.detail || evt.actionType,
        timestamp: evt.timestamp || "",
        events: [evt],
        status: evt.actionType === "error" ? "error" : "complete",
      });
    }
  }

  return groups.reverse();
}

export function useTaskGroups(activities: ActivityEvent[], limit?: number): TaskGroup[] {
  return useMemo(() => {
    const groups = groupActivities(activities);
    return limit ? groups.slice(0, limit) : groups;
  }, [activities, limit]);
}
