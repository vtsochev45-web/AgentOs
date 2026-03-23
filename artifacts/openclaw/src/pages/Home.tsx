import { useListAgents, useListActivity } from "@workspace/api-client-react";
import { Link } from "wouter";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { Brain, Cpu, Clock, TerminalSquare, AlertCircle, Plus, Activity } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export default function Home() {
  const { data: agents, isLoading: isLoadingAgents } = useListAgents();
  const { data: activities, isLoading: isLoadingActivity } = useListActivity({ limit: 5 });

  return (
    <div className="max-w-6xl mx-auto space-y-8 h-full">
      <header className="mb-8">
        <h1 className="text-4xl font-bold text-white tracking-tight flex items-center gap-3">
          <TerminalSquare className="w-8 h-8 text-primary" />
          Command Center
        </h1>
        <p className="text-muted-foreground mt-2 font-mono text-sm">OS VERSION 0.1.0 // ALL SYSTEMS NOMINAL</p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Agent Team Overview */}
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
          ) : agents?.length === 0 ? (
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
              {agents?.slice(0, 4).map(agent => (
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

        {/* Global Activity Feed */}
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-green-400" />
              Live Telemetry
            </h2>
          </div>

          <div className="glass-panel rounded-2xl p-4 h-[400px] overflow-hidden flex flex-col">
            {isLoadingActivity ? (
               <div className="animate-pulse space-y-4 pt-2">
                 {[1,2,3,4,5].map(i => <div key={i} className="h-10 bg-white/5 rounded-lg" />)}
               </div>
            ) : activities?.length === 0 ? (
              <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
                No recent activity.
              </div>
            ) : (
              <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                {activities?.map(act => (
                  <div key={act.id} className="p-3 rounded-xl bg-black/20 border border-white/5 text-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-primary/90">{act.agentName || 'SYSTEM'}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {formatDistanceToNow(new Date(act.timestamp), {addSuffix: true})}
                      </span>
                    </div>
                    <div className="text-white/80">
                      <span className="text-xs uppercase tracking-wider text-accent font-bold mr-2">[{act.actionType}]</span>
                      {act.detail}
                    </div>
                  </div>
                ))}
              </div>
            )}
            <Link href="/activity" className="mt-4 text-center text-xs text-primary/70 hover:text-primary w-full py-2 bg-white/5 rounded-lg">
              View Full Feed
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
