import { useEffect, useRef, useState } from "react";
import { useGetVpsStats, useListVpsProcesses, useListVpsServices, useControlVpsService } from "@workspace/api-client-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useWebSocketTerminal } from "@/hooks/use-websocket";
import { Server, Activity, Cpu, HardDrive, TerminalSquare, Play, Square, RotateCw, Clock } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";

export default function VPS() {
  const [activeTab, setActiveTab] = useState<'terminal' | 'stats' | 'services'>('terminal');
  
  return (
    <div className="max-w-7xl mx-auto h-full flex flex-col">
      <header className="mb-6 flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Server className="w-8 h-8 text-primary" />
            VPS Uplink
          </h1>
          <p className="text-muted-foreground mt-2 text-sm font-mono">DIRECT SECURE SHELL & TELEMETRY</p>
        </div>
        <div className="flex bg-black/40 p-1 rounded-lg border border-white/10">
          {(['terminal', 'stats', 'services'] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`px-4 py-1.5 rounded-md text-sm font-medium capitalize transition-all ${activeTab === t ? 'bg-white/10 text-white shadow-sm' : 'text-muted-foreground hover:text-white/80'}`}
            >
              {t}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 glass-panel rounded-2xl overflow-hidden relative flex flex-col">
        {activeTab === 'terminal' && <TerminalView />}
        {activeTab === 'stats' && <StatsView />}
        {activeTab === 'services' && <ServicesView />}
      </div>
    </div>
  );
}

function TerminalView() {
  const terminalRef = useRef<HTMLDivElement>(null);
  const { connect, disconnect, sendData, resize, onData, isConnected } = useWebSocketTerminal("/api/vps/terminal");
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;
    
    const term = new Terminal({
      theme: {
        background: '#0A0F1C', // Match our dark theme
        foreground: '#e2e8f0',
        cursor: '#06b6d4',
        selectionBackground: 'rgba(6, 182, 212, 0.3)',
      },
      fontFamily: '"JetBrains Mono", monospace',
      fontSize: 14,
      cursorBlink: true,
      allowProposedApi: true
    });
    
    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    
    term.open(terminalRef.current);
    fitAddon.fit();
    
    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    term.onData(data => sendData(data));
    
    onData(data => {
      term.write(data);
    });

    connect();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        resize(term.cols, term.rows);
      } catch (e) {} // ignore fit errors when hidden
    });
    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      disconnect();
      term.dispose();
    };
  }, [connect, disconnect, onData, resize, sendData]);

  return (
    <div className="w-full h-full bg-[#0A0F1C] relative">
      {!isConnected && (
         <div className="absolute inset-0 bg-black/60 z-10 flex items-center justify-center backdrop-blur-sm">
            <div className="text-center font-mono">
              <TerminalSquare className="w-8 h-8 text-primary/50 mx-auto mb-4 animate-pulse" />
              <p className="text-primary/70">ESTABLISHING SSH TUNNEL...</p>
            </div>
         </div>
      )}
      <div ref={terminalRef} className="w-full h-full p-2" />
    </div>
  );
}

function StatsView() {
  const { data: stats, isLoading } = useGetVpsStats({ query: { refetchInterval: 5000 } });
  const { data: procs } = useListVpsProcesses({ query: { refetchInterval: 10000 } });

  if (isLoading || !stats) return <div className="p-8 text-center text-primary font-mono animate-pulse">GATHERING TELEMETRY...</div>;

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="CPU USAGE" icon={Cpu} value={`${stats.cpuPercent.toFixed(1)}%`} progress={stats.cpuPercent} />
        <StatCard title="MEMORY" icon={Activity} value={`${(stats.memUsedMb/1024).toFixed(1)} / ${(stats.memTotalMb/1024).toFixed(1)} GB`} progress={(stats.memUsedMb/stats.memTotalMb)*100} />
        <StatCard title="DISK" icon={HardDrive} value={`${stats.diskUsedGb.toFixed(1)} / ${stats.diskTotalGb.toFixed(1)} GB`} progress={(stats.diskUsedGb/stats.diskTotalGb)*100} />
        <StatCard title="UPTIME" icon={Clock} value={stats.uptime} />
      </div>

      <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
         <Activity className="w-5 h-5 text-accent" /> Active Processes
      </h3>
      <div className="bg-black/30 rounded-xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-white/5 text-muted-foreground font-mono text-[10px] uppercase">
            <tr>
              <th className="px-4 py-3 font-medium">PID</th>
              <th className="px-4 py-3 font-medium">User</th>
              <th className="px-4 py-3 font-medium">CPU%</th>
              <th className="px-4 py-3 font-medium">MEM%</th>
              <th className="px-4 py-3 font-medium">Command</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {procs?.slice(0, 15).map(p => (
              <tr key={p.pid} className="hover:bg-white/5 font-mono text-white/80">
                <td className="px-4 py-2 text-primary/80">{p.pid}</td>
                <td className="px-4 py-2">{p.user}</td>
                <td className="px-4 py-2">{p.cpu}</td>
                <td className="px-4 py-2">{p.mem}</td>
                <td className="px-4 py-2 truncate max-w-xs">{p.command}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, icon: Icon, value, progress }: any) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 relative overflow-hidden">
      <div className="flex justify-between items-start mb-2 relative z-10">
        <span className="text-xs font-mono text-muted-foreground">{title}</span>
        <Icon className="w-4 h-4 text-primary/50" />
      </div>
      <div className="text-xl font-bold text-white font-mono relative z-10">{value}</div>
      {progress !== undefined && (
        <div className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full">
           <div className="h-full bg-primary" style={{width: `${progress}%`}} />
        </div>
      )}
    </div>
  );
}

function ServicesView() {
  const { data: services, isLoading } = useListVpsServices();
  const controlMutation = useControlVpsService();
  const queryClient = useQueryClient();

  const handleControl = (name: string, action: 'start'|'stop'|'restart') => {
    controlMutation.mutate({ name, action }, {
       onSuccess: () => queryClient.invalidateQueries({ queryKey: ['/api/vps/services'] })
    });
  };

  if (isLoading) return <div className="p-8 text-center text-primary font-mono animate-pulse">SCANNING DAEMONS...</div>;

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar">
       <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {services?.map(s => {
             const isActive = s.status.includes('running') || s.status.includes('online');
             return (
               <div key={s.name} className="bg-black/30 border border-white/10 rounded-xl p-5 flex flex-col">
                  <div className="flex justify-between items-start mb-4">
                     <div className="font-bold text-white truncate pr-2">{s.name}</div>
                     <div className={`px-2 py-0.5 rounded text-[10px] uppercase font-bold tracking-wider ${isActive ? 'bg-green-500/20 text-green-400 border border-green-500/30' : 'bg-red-500/20 text-red-400 border border-red-500/30'}`}>
                        {isActive ? 'ACTIVE' : 'STOPPED'}
                     </div>
                  </div>
                  <div className="text-xs text-muted-foreground font-mono mb-4">TYPE: {s.type}</div>
                  
                  <div className="mt-auto flex gap-2">
                     <button onClick={() => handleControl(s.name, 'start')} disabled={isActive} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold disabled:opacity-30">
                        <Play className="w-3 h-3 mr-1" /> START
                     </button>
                     <button onClick={() => handleControl(s.name, 'restart')} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold">
                        <RotateCw className="w-3 h-3 mr-1" /> RESTART
                     </button>
                     <button onClick={() => handleControl(s.name, 'stop')} disabled={!isActive} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold disabled:opacity-30">
                        <Square className="w-3 h-3 mr-1" /> STOP
                     </button>
                  </div>
               </div>
             );
          })}
       </div>
    </div>
  );
}

