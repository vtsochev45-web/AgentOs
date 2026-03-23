import { useEffect, useState } from "react";
import { useListActivity } from "@workspace/api-client-react";
import { Activity as ActivityIcon, CheckCircle2, Terminal, Globe, FileCode2, MessageSquare, ShieldAlert, Wifi, WifiOff, GitBranch } from "lucide-react";
import { format } from "date-fns";
import { useSSEActivity, type ActivityEvent } from "@/hooks/use-sse";

export default function Activity() {
  const { data: initialActivities, isLoading } = useListActivity({ limit: 100 });
  const { events: sseEvents, isConnected, connect, disconnect } = useSSEActivity();
  const [activities, setActivities] = useState<ActivityEvent[]>([]);

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
        return [...newEvents, ...prev].slice(0, 200);
      });
    }
  }, [sseEvents]);

  const getIconForAction = (type: string) => {
    switch(type.toLowerCase()) {
      case 'search': return <Globe className="w-5 h-5 text-yellow-400" />;
      case 'exec':
      case 'vps_shell': return <Terminal className="w-5 h-5 text-red-400" />;
      case 'file':
      case 'file_read':
      case 'file_write': return <FileCode2 className="w-5 h-5 text-blue-400" />;
      case 'message':
      case 'send_email': return <MessageSquare className="w-5 h-5 text-purple-400" />;
      case 'delegate': return <GitBranch className="w-5 h-5 text-cyan-400" />;
      case 'error': return <ShieldAlert className="w-5 h-5 text-destructive" />;
      default: return <CheckCircle2 className="w-5 h-5 text-green-400" />;
    }
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
               {[1,2,3,4,5,6].map(i => <div key={i} className="h-16 bg-white/5 rounded-xl" />)}
            </div>
         ) : activities.length === 0 ? (
           <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
             Waiting for activity events...
           </div>
         ) : (
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 custom-scrollbar">
               {activities.map((act, i) => (
                 <div key={act.id ?? i} className="bg-black/30 border border-white/5 rounded-xl p-4 flex gap-4 hover:bg-black/40 transition-colors">
                    <div className="mt-1">
                      {getIconForAction(act.actionType)}
                    </div>
                    <div className="flex-1">
                       <div className="flex justify-between items-start mb-1">
                          <div className="font-semibold text-white">
                             {act.agentName ? (
                               <span className="text-primary">{act.agentName}</span>
                             ) : (
                               <span className="text-muted-foreground">SYSTEM</span>
                             )}
                             <span className="text-white/40 mx-2">/</span>
                             <span className="uppercase text-xs font-bold tracking-wider">{act.actionType}</span>
                          </div>
                          <div className="text-xs text-muted-foreground font-mono">
                             {act.timestamp ? format(new Date(act.timestamp), "HH:mm:ss.SSS") : "--:--:--.---"}
                          </div>
                       </div>
                       <p className="text-sm text-white/80 font-mono leading-relaxed mt-2 p-3 bg-black/40 rounded-lg border border-white/5">
                          {act.detail}
                       </p>
                    </div>
                 </div>
               ))}
            </div>
         )}
      </div>
    </div>
  );
}
