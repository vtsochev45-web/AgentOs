import type { Agent } from "@workspace/api-client-react";

type AgentStatus = Agent["status"];

export function AgentStatusBadge({ status }: { status: AgentStatus }) {
  const config: Record<string, { color: string; glow: string; label: string }> = {
    idle: { color: "bg-gray-500", glow: "status-glow-idle", label: "Idle" },
    thinking: { color: "bg-blue-500", glow: "status-glow-thinking animate-pulse-fast", label: "Thinking" },
    searching: { color: "bg-yellow-500", glow: "status-glow-searching animate-pulse-fast", label: "Searching" },
    writing: { color: "bg-green-500", glow: "status-glow-writing animate-pulse-fast", label: "Writing" },
    delegating: { color: "bg-purple-500", glow: "status-glow-delegating animate-pulse-fast", label: "Delegating" },
    executing: { color: "bg-red-500", glow: "status-glow-executing animate-pulse-fast", label: "Executing" },
  };

  const current = (status && config[status]) ? config[status] : config["idle"]!;

  return (
    <div className="flex items-center gap-2 px-2.5 py-1 rounded-full bg-white/5 border border-white/10 w-fit">
      <div className={`w-2 h-2 rounded-full ${current.color} ${current.glow}`} />
      <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{current.label}</span>
    </div>
  );
}
