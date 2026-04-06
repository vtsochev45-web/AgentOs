import { useEffect, useState, useMemo } from "react";
import { useListActivity } from "@workspace/api-client-react";
import { Activity as ActivityIcon, CheckCircle2, Terminal, Globe, FileCode2, MessageSquare, ShieldAlert, Wifi, WifiOff, GitBranch, ChevronDown, ChevronRight, Bot, Loader2 } from "lucide-react";
import { format } from "date-fns";
import { useSSEActivity, type ActivityEvent } from "@/hooks/use-sse";

interface TaskGroup {
  id: string;
  agentName: string;
  query: string;
  timestamp: string;
  events: ActivityEvent[];
  status: "running" | "complete" | "error";
}

function groupActivities(activities: ActivityEvent[]): TaskGroup[] {
  const groups: TaskGroup[] = [];
  let current: TaskGroup | null = null;

  // Process in chronological order (oldest first) then reverse
  const sorted = [...activities].sort((a, b) => {
    const ta = a.timestamp ? new Date(a.timestamp).getTime() : 0;
    const tb = b.timestamp ? new Date(b.timestamp).getTime() : 0;
    return ta - tb;
  });

  for (const evt of sorted) {
    if (evt.actionType === "chat" && evt.detail?.startsWith("Received:")) {
      // New task — start a new group
      current = {
        id: `${evt.agentName}-${evt.timestamp}`,
        agentName: evt.agentName || "Agent",
        query: evt.detail.replace(/^Received:\s*"?|"?\s*$/g, ""),
        timestamp: evt.timestamp || "",
        events: [evt],
        status: "running",
      };
      groups.push(current);
    } else if (current && evt.agentName === current.agentName) {
      current.events.push(evt);
      if (evt.actionType === "complete") current.status = "complete";
      if (evt.actionType === "error") current.status = "error";
    } else if (current) {
      // Different agent — might be delegation, still attach to current task
      current.events.push(evt);
      if (evt.actionType === "complete") current.status = "complete";
    } else {
      // Orphan event — create standalone group
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

  // Reverse so newest first
  return groups.reverse();
}

const getStepIcon = (type: string) => {
  switch (type.toLowerCase()) {
    case "search": return <Globe className="w-3.5 h-3.5 text-yellow-400" />;
    case "exec":
    case "vps_shell": return <Terminal className="w-3.5 h-3.5 text-red-400" />;
    case "tool":
    case "tool_detail":
    case "tool_call": return <Terminal className="w-3.5 h-3.5 text-orange-400" />;
    case "file":
    case "file_read":
    case "file_write": return <FileCode2 className="w-3.5 h-3.5 text-blue-400" />;
    case "delegate": return <GitBranch className="w-3.5 h-3.5 text-cyan-400" />;
    case "complete": return <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />;
    case "error": return <ShieldAlert className="w-3.5 h-3.5 text-destructive" />;
    case "message":
    case "send_email": return <MessageSquare className="w-3.5 h-3.5 text-purple-400" />;
    default: return <CheckCircle2 className="w-3.5 h-3.5 text-white/40" />;
  }
};

export default function Activity() {
  const { data: initialActivities, isLoading } = useListActivity({ limit: 200 });
  const { events: sseEvents, isConnected, connect, disconnect } = useSSEActivity();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  useEffect(() => {
    if (initialActivities && activities.length === 0 && sseEvents.length === 0) {
      setActivities(initialActivities as ActivityEvent[]);
    }
  }, [initialActivities, activities.length, sseEvents.length]);

  useEffect(() => {
    if (sseEvents.length > 0) {
      setActivities((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const newEvents = sseEvents.filter((e) => !existingIds.has(e.id));
        return [...newEvents, ...prev].slice(0, 300);
      });
    }
  }, [sseEvents]);

  const groups = useMemo(() => groupActivities(activities), [activities]);

  // Auto-expand the latest running group
  useEffect(() => {
    const running = groups.find(g => g.status === "running");
    if (running) {
      setExpandedGroups(prev => new Set([...prev, running.id]));
    }
  }, [groups]);

  const toggleGroup = (id: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <header className="mb-8 shrink-0">
        <div className="flex items-center justify-between">
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <ActivityIcon className="w-8 h-8 text-primary" />
            Global Telemetry
          </h1>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            {isConnected ? (
              <><Wifi className="w-3 h-3 text-green-400 animate-pulse" /><span className="text-green-400">LIVE</span></>
            ) : (
              <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400">RECONNECTING</span></>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-2 text-sm">Real-time log of all system and agent operations.</p>
      </header>

      <div className="flex-1 glass-panel rounded-2xl overflow-hidden flex flex-col">
        {isLoading && activities.length === 0 ? (
          <div className="p-8 space-y-4 animate-pulse">
            {[1,2,3,4,5].map(i => <div key={i} className="h-20 bg-white/5 rounded-xl" />)}
          </div>
        ) : groups.length === 0 ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            Waiting for activity events...
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-3 custom-scrollbar">
            {groups.map((group) => {
              const isExpanded = expandedGroups.has(group.id);
              const stepEvents = group.events.filter(e => e.actionType !== "chat" || !e.detail?.startsWith("Received:"));
              const toolCount = stepEvents.filter(e => ["tool", "tool_detail", "tool_call"].includes(e.actionType)).length;
              const completionEvt = stepEvents.find(e => e.actionType === "complete");

              return (
                <div key={group.id} className="bg-black/30 border border-white/5 rounded-xl overflow-hidden hover:border-white/10 transition-colors">
                  {/* Header — always visible */}
                  <div
                    className="flex items-center gap-3 p-4 cursor-pointer select-none"
                    onClick={() => toggleGroup(group.id)}
                  >
                    {/* Status indicator */}
                    {group.status === "running" ? (
                      <Loader2 className="w-5 h-5 text-primary animate-spin shrink-0" />
                    ) : group.status === "error" ? (
                      <ShieldAlert className="w-5 h-5 text-destructive shrink-0" />
                    ) : (
                      <CheckCircle2 className="w-5 h-5 text-green-400 shrink-0" />
                    )}

                    {/* Agent + query */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary shrink-0" />
                        <span className="text-primary font-semibold text-sm">{group.agentName}</span>
                        {toolCount > 0 && (
                          <span className="text-[10px] font-mono text-white/40 bg-white/5 px-1.5 py-0.5 rounded">
                            {toolCount} tools
                          </span>
                        )}
                        {completionEvt && (
                          <span className="text-[10px] font-mono text-green-400/70 bg-green-400/10 px-1.5 py-0.5 rounded">
                            {completionEvt.detail?.substring(0, 50)}
                          </span>
                        )}
                      </div>
                      <p className="text-white/80 text-sm mt-0.5 truncate">{group.query}</p>
                    </div>

                    {/* Time + expand */}
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-xs text-muted-foreground font-mono">
                        {group.timestamp ? format(new Date(group.timestamp), "HH:mm:ss") : "--:--:--"}
                      </span>
                      {stepEvents.length > 0 && (
                        isExpanded
                          ? <ChevronDown className="w-4 h-4 text-white/40" />
                          : <ChevronRight className="w-4 h-4 text-white/40" />
                      )}
                    </div>
                  </div>

                  {/* Steps — collapsible */}
                  {isExpanded && stepEvents.length > 0 && (
                    <div className="border-t border-white/5 px-4 py-2 space-y-1 bg-black/20">
                      {stepEvents.map((evt, i) => (
                        <div key={evt.id ?? i} className="flex items-start gap-2 py-1">
                          <div className="mt-0.5 shrink-0">{getStepIcon(evt.actionType)}</div>
                          <span className="text-xs text-white/50 font-mono shrink-0 w-16">
                            {evt.timestamp ? format(new Date(evt.timestamp), "HH:mm:ss") : ""}
                          </span>
                          <span className="text-xs text-white/70 font-mono break-all">
                            <span className="text-white/40">{evt.actionType}: </span>
                            {evt.detail}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
