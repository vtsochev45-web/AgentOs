import { useState, useEffect, useCallback } from "react";
import { useListAgents, useListActivity } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { Brain, Cpu, Clock, TerminalSquare, AlertCircle, Plus, Activity, Wifi, WifiOff, Bot, CheckCircle2, ShieldAlert, Loader2, Terminal, ChevronDown, ChevronRight } from "lucide-react";
import { formatDistanceToNow, format } from "date-fns";
import { useSSEActivity, useSSEAgentStatus, type ActivityEvent } from "@/hooks/use-sse";
import { useQueryClient } from "@tanstack/react-query";
import { getListAgentsQueryKey } from "@workspace/api-client-react";
import type { Agent } from "@workspace/api-client-react";
import { useTaskGroups } from "@/hooks/use-task-grouping";

export default function Home() {
  const { data: agentsRaw, isLoading: isLoadingAgents } = useListAgents();
  const { data: activitiesRaw, isLoading: isLoadingActivity } = useListActivity({ limit: 200 });
  const queryClient = useQueryClient();

  const [liveActivities, setLiveActivities] = useState<ActivityEvent[]>([]);
  const [agentStatusOverrides, setAgentStatusOverrides] = useState<Record<number, string>>({});

  const { events: sseEvents, isConnected: activityConnected, connect: connectActivity, disconnect: disconnectActivity } = useSSEActivity();

  const handleAgentStatus = useCallback((ev: { agentId: number; status: string }) => {
    setAgentStatusOverrides((prev) => ({ ...prev, [ev.agentId]: ev.status }));
    queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
  }, [queryClient]);

  const { isConnected: agentConnected, connect: connectAgentStatus, disconnect: disconnectAgentStatus } = useSSEAgentStatus(handleAgentStatus);

  useEffect(() => {
    connectActivity();
    connectAgentStatus();
    return () => {
      disconnectActivity();
      disconnectAgentStatus();
    };
  }, [connectActivity, connectAgentStatus, disconnectActivity, disconnectAgentStatus]);

  useEffect(() => {
    if (sseEvents.length > 0) {
      setLiveActivities(sseEvents.slice(0, 5));
    }
  }, [sseEvents]);

  const allActivities = useMemo(() => {
    const initial = (activitiesRaw ?? []) as ActivityEvent[];
    const merged = [...liveActivities];
    const ids = new Set(merged.map(e => e.id));
    for (const e of initial) { if (!ids.has(e.id)) merged.push(e); }
    return merged;
  }, [activitiesRaw, liveActivities]);

  const taskGroups = useTaskGroups(allActivities, 8);

  const [expandedHome, setExpandedHome] = useState<string | null>(null);

  const agents = (agentsRaw ?? []).map((a) => ({
    ...a,
    status: (agentStatusOverrides[a.id] ?? a.status) as Agent["status"],
  }));

  const isConnected = activityConnected && agentConnected;

  return (
    <div className="max-w-6xl mx-auto space-y-8 h-full">
      <header className="mb-8">
        <div className="flex items-center justify-between">
          <h1 className="text-4xl font-bold text-white tracking-tight flex items-center gap-3">
            <TerminalSquare className="w-8 h-8 text-primary" />
            Command Center
          </h1>
          <div className="flex items-center gap-1.5 text-xs font-mono">
            {isConnected ? (
              <><Wifi className="w-3 h-3 text-green-400" /><span className="text-green-400">LIVE</span></>
            ) : (
              <><WifiOff className="w-3 h-3 text-red-400" /><span className="text-red-400">OFFLINE</span></>
            )}
          </div>
        </div>
        <p className="text-muted-foreground mt-2 font-mono text-sm">OS VERSION 0.1.0 // ALL SYSTEMS NOMINAL</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Brain className="w-5 h-5 text-accent" />
              Active Roster
            </h2>
            <Link href="/agents" className="text-sm text-primary hover:underline">View All</Link>
          </div>

          {isLoadingAgents ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[1,2,3,4].map(i => (
                <div key={i} className="glass-panel p-6 rounded-2xl h-32 animate-pulse" />
              ))}
            </div>
          ) : agents.length === 0 ? (
            <div className="glass-panel p-10 rounded-2xl flex flex-col items-center justify-center text-center">
              <AlertCircle className="w-10 h-10 text-muted-foreground mb-4" />
              <h3 className="text-lg font-medium text-white mb-2">No agents active</h3>
              <p className="text-muted-foreground text-sm mb-6">Initialize your first agent to begin operations.</p>
              <Link href="/agents" className="glass-button px-6 py-2 rounded-lg text-primary flex items-center gap-2">
                <Plus className="w-4 h-4" /> Deploy Agent
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {agents.slice(0, 4).map(agent => (
                <Link key={agent.id} href={`/agents/${agent.id}`} className="glass-panel p-5 rounded-2xl hover:border-primary/50 transition-colors group cursor-pointer block">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <h3 className="text-lg font-bold text-white group-hover:text-primary transition-colors">{agent.name}</h3>
                      <p className="text-xs text-muted-foreground font-mono mt-1 truncate max-w-[150px]">{agent.persona}</p>
                    </div>
                    <AgentStatusBadge status={agent.status} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground mt-4 pt-4 border-t border-white/5">
                    <div className="flex items-center gap-1">
                      <Cpu className="w-3 h-3" /> {agent.toolsEnabled.length} Tools
                    </div>
                    <div className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {agent.lastActiveAt ? formatDistanceToNow(new Date(agent.lastActiveAt), {addSuffix: true}) : 'Never'}
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              Live Telemetry
            </h2>
          </div>

          <div className="glass-panel rounded-2xl p-4 h-[400px] overflow-hidden flex flex-col">
            {isLoadingActivity && liveActivities.length === 0 ? (
               <div className="animate-pulse space-y-4 pt-2">
                 {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-white/5 rounded-lg" />)}
               </div>
            ) : taskGroups.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                No recent activity.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
                {taskGroups.map((group) => {
                  const isExp = expandedHome === group.id;
                  const steps = group.events.filter(e => e.actionType !== "chat" || !e.detail?.startsWith("Received:"));
                  const toolCount = steps.filter(e => ["tool", "tool_detail", "tool_call"].includes(e.actionType)).length;
                  const completionEvt = steps.find(e => e.actionType === "complete");
                  return (
                    <div key={group.id} className="bg-black/20 border border-white/5 rounded-xl overflow-hidden">
                      <div className="flex items-center gap-2.5 p-3 cursor-pointer select-none" onClick={() => setExpandedHome(isExp ? null : group.id)}>
                        {group.status === "running" ? <Loader2 className="w-4 h-4 text-primary animate-spin shrink-0" /> : group.status === "error" ? <ShieldAlert className="w-4 h-4 text-destructive shrink-0" /> : <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5">
                            <Bot className="w-3.5 h-3.5 text-primary shrink-0" />
                            <span className="text-primary font-semibold text-xs">{group.agentName}</span>
                            {toolCount > 0 && <span className="text-[9px] font-mono text-white/40 bg-white/5 px-1 py-0.5 rounded">{toolCount} tools</span>}
                            {completionEvt && <span className="text-[9px] font-mono text-green-400/70 bg-green-400/10 px-1 py-0.5 rounded truncate">{completionEvt.detail?.substring(0, 40)}</span>}
                          </div>
                          <p className="text-white/80 text-xs mt-0.5 truncate">{group.query}</p>
                        </div>
                        <span className="text-[10px] text-muted-foreground font-mono shrink-0">{group.timestamp ? format(new Date(group.timestamp), "HH:mm") : ""}</span>
                        {steps.length > 0 && (isExp ? <ChevronDown className="w-3.5 h-3.5 text-white/30 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 text-white/30 shrink-0" />)}
                      </div>
                      {isExp && steps.length > 0 && (
                        <div className="border-t border-white/5 px-3 py-1.5 space-y-0.5 bg-black/20 max-h-32 overflow-y-auto custom-scrollbar">
                          {steps.map((evt, i) => (
                            <div key={evt.id ?? i} className="flex items-start gap-1.5 py-0.5">
                              <Terminal className="w-3 h-3 text-white/30 mt-0.5 shrink-0" />
                              <span className="text-[10px] text-white/60 font-mono break-all"><span className="text-white/30">{evt.actionType}:</span> {evt.detail}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
            <Link href="/activity" className="mt-3 text-center text-xs text-primary/70 hover:text-primary w-full py-2 bg-white/5 rounded-lg">
              View Full Feed
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
