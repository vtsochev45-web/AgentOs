import { useEffect, useRef, useState, useCallback } from "react";
import { useGetVpsStats, getGetVpsStatsQueryKey, useListVpsProcesses, getListVpsProcessesQueryKey, useListVpsServices, getListVpsServicesQueryKey, useControlVpsService } from "@workspace/api-client-react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useWebSocketTerminal } from "@/hooks/use-websocket";
import { Server, Activity, Cpu, HardDrive, TerminalSquare, Play, Square, RotateCw, Clock, Folder, FileText, Skull, ChevronRight, RefreshCw, Upload, Download, Trash2 } from "lucide-react";
import { useQueryClient, useQuery, useMutation } from "@tanstack/react-query";

type Tab = 'terminal' | 'stats' | 'services' | 'files' | 'logs';

export default function VPS() {
  const [activeTab, setActiveTab] = useState<Tab>('terminal');
  
  const tabs: { id: Tab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'stats', label: 'Stats' },
    { id: 'services', label: 'Services' },
    { id: 'files', label: 'Files' },
    { id: 'logs', label: 'Logs' },
  ];

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
        <div className="flex bg-black/40 p-1 rounded-lg border border-white/10 overflow-x-auto">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-1.5 rounded-md text-sm font-medium capitalize transition-all whitespace-nowrap ${activeTab === t.id ? 'bg-white/10 text-white shadow-sm' : 'text-muted-foreground hover:text-white/80'}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 glass-panel rounded-2xl overflow-hidden relative flex flex-col">
        {activeTab === 'terminal' && <TerminalView />}
        {activeTab === 'stats' && <StatsView />}
        {activeTab === 'services' && <ServicesView />}
        {activeTab === 'files' && <FilesView />}
        {activeTab === 'logs' && <LogsView />}
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
        background: '#0A0F1C',
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
    onData(data => { term.write(data); });
    connect();

    const resizeObserver = new ResizeObserver(() => {
      try {
        fitAddon.fit();
        resize(term.cols, term.rows);
      } catch (e) {}
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
  const { data: stats, isLoading } = useGetVpsStats({ query: { queryKey: getGetVpsStatsQueryKey(), refetchInterval: 5000 } });
  const { data: procs, refetch: refetchProcs } = useListVpsProcesses({ query: { queryKey: getListVpsProcessesQueryKey(), refetchInterval: 10000 } });
  const queryClient = useQueryClient();

  const killMutation = useMutation({
    mutationFn: async (pid: number) => {
      const res = await fetch(`/api/vps/processes/${pid}/kill`, { method: "POST" });
      if (!res.ok) throw new Error("Kill failed");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/vps/processes"] });
    },
  });

  if (isLoading || !stats) return <div className="p-8 text-center text-primary font-mono animate-pulse">GATHERING TELEMETRY...</div>;

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-8">
        <StatCard title="CPU USAGE" icon={Cpu} value={`${stats.cpuPercent.toFixed(1)}%`} progress={stats.cpuPercent} />
        <StatCard title="MEMORY" icon={Activity} value={`${(stats.memUsedMb/1024).toFixed(1)} / ${(stats.memTotalMb/1024).toFixed(1)} GB`} progress={(stats.memUsedMb/stats.memTotalMb)*100} />
        <StatCard title="DISK" icon={HardDrive} value={`${stats.diskUsedGb.toFixed(0)} / ${stats.diskTotalGb.toFixed(0)} GB`} progress={(stats.diskUsedGb/stats.diskTotalGb)*100} />
        <StatCard title="UPTIME" icon={Clock} value={stats.uptime} />
      </div>

      <div className="flex justify-between items-center mb-4">
        <h3 className="text-lg font-bold text-white flex items-center gap-2">
          <Activity className="w-5 h-5 text-primary" /> Active Processes
        </h3>
        <button onClick={() => refetchProcs()} className="p-1.5 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>
      <div className="bg-black/30 rounded-xl border border-white/5 overflow-hidden">
        <table className="w-full text-sm text-left">
          <thead className="bg-white/5 text-muted-foreground font-mono text-[10px] uppercase">
            <tr>
              <th className="px-4 py-3">PID</th>
              <th className="px-4 py-3">User</th>
              <th className="px-4 py-3">CPU%</th>
              <th className="px-4 py-3">MEM%</th>
              <th className="px-4 py-3">Command</th>
              <th className="px-4 py-3">Kill</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-white/5">
            {procs?.slice(0, 20).map(p => (
              <tr key={p.pid} className="hover:bg-white/5 font-mono text-white/80">
                <td className="px-4 py-2 text-primary/80">{p.pid}</td>
                <td className="px-4 py-2">{p.user}</td>
                <td className="px-4 py-2">{p.cpu}</td>
                <td className="px-4 py-2">{p.mem}</td>
                <td className="px-4 py-2 truncate max-w-xs">{p.command}</td>
                <td className="px-4 py-2">
                  <button
                    onClick={() => killMutation.mutate(p.pid)}
                    disabled={killMutation.isPending}
                    title={`Kill PID ${p.pid}`}
                    className="p-1.5 rounded-lg bg-red-500/10 hover:bg-red-500/30 text-red-400 hover:text-red-300 transition-colors disabled:opacity-40"
                  >
                    <Skull className="w-3 h-3" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function StatCard({ title, icon: Icon, value, progress }: { title: string; icon: React.ComponentType<{ className?: string }>; value: string; progress?: number }) {
  return (
    <div className="bg-white/5 border border-white/10 rounded-xl p-4 relative overflow-hidden">
      <div className="flex justify-between items-start mb-2 relative z-10">
        <span className="text-xs font-mono text-muted-foreground">{title}</span>
        <Icon className="w-4 h-4 text-primary/50" />
      </div>
      <div className="text-xl font-bold text-white font-mono relative z-10">{value}</div>
      {progress !== undefined && (
        <div className="absolute bottom-0 left-0 h-1 bg-primary/20 w-full">
          <div className="h-full bg-primary transition-all duration-500" style={{ width: `${Math.min(100, progress)}%` }} />
        </div>
      )}
    </div>
  );
}

function ServicesView() {
  const { data: services, isLoading } = useListVpsServices({ query: { queryKey: getListVpsServicesQueryKey() } });
  const controlMutation = useControlVpsService();
  const queryClient = useQueryClient();

  const handleControl = (name: string, action: 'start' | 'stop' | 'restart') => {
    controlMutation.mutate({ name, action }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/vps/services"] })
    });
  };

  if (isLoading) return <div className="p-8 text-center text-primary font-mono animate-pulse">SCANNING DAEMONS...</div>;
  if (!services?.length) return <div className="p-8 text-center text-muted-foreground font-mono">No services found. Connect VPS in Settings.</div>;

  return (
    <div className="p-6 h-full overflow-y-auto custom-scrollbar">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {services.map(s => {
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
                <button onClick={() => handleControl(s.name, 'start')} disabled={isActive} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold disabled:opacity-30 transition-all">
                  <Play className="w-3 h-3 mr-1" /> START
                </button>
                <button onClick={() => handleControl(s.name, 'restart')} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 text-xs font-semibold transition-all">
                  <RotateCw className="w-3 h-3 mr-1" /> RESTART
                </button>
                <button onClick={() => handleControl(s.name, 'stop')} disabled={!isActive} className="flex-1 py-2 flex justify-center items-center rounded-lg bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 text-red-400 text-xs font-semibold disabled:opacity-30 transition-all">
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

interface FileEntry {
  name: string;
  path: string;
  type: "file" | "directory" | "symlink";
  size: number;
  modifiedAt: string;
}

function FilesView() {
  const [currentPath, setCurrentPath] = useState("/");
  const [editingFile, setEditingFile] = useState<{ path: string; content: string } | null>(null);
  const [editContent, setEditContent] = useState("");
  const uploadInputRef = useRef<HTMLInputElement>(null);

  const { data: entries, isLoading, error, refetch } = useQuery<FileEntry[]>({
    queryKey: ["/api/vps/files", currentPath],
    queryFn: async () => {
      const res = await fetch(`/api/vps/files?path=${encodeURIComponent(currentPath)}`);
      if (!res.ok) throw new Error("Failed to list files");
      return res.json() as Promise<FileEntry[]>;
    },
  });

  const readFile = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`/api/vps/files/read?path=${encodeURIComponent(path)}`);
      if (!res.ok) throw new Error("Cannot read file");
      return res.json() as Promise<{ content: string; path: string }>;
    },
    onSuccess: (data) => {
      setEditingFile({ path: data.path, content: data.content });
      setEditContent(data.content);
    },
  });

  const writeFile = useMutation({
    mutationFn: async ({ path, content }: { path: string; content: string }) => {
      const res = await fetch("/api/vps/files/write", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path, content }),
      });
      if (!res.ok) throw new Error("Write failed");
      return res.json();
    },
    onSuccess: () => { setEditingFile(null); refetch(); },
  });

  const deleteFile = useMutation({
    mutationFn: async (path: string) => {
      const res = await fetch(`/api/vps/files/delete?path=${encodeURIComponent(path)}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Delete failed");
      return res.json();
    },
    onSuccess: () => refetch(),
  });

  const uploadFile = useMutation({
    mutationFn: async (file: File) => {
      const content = await file.text();
      const filePath = currentPath.endsWith("/") ? `${currentPath}${file.name}` : `${currentPath}/${file.name}`;
      const res = await fetch("/api/vps/files/upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: filePath, content }),
      });
      if (!res.ok) throw new Error("Upload failed");
      return res.json();
    },
    onSuccess: () => refetch(),
  });

  const downloadFile = (path: string) => {
    window.open(`/api/vps/files/download?path=${encodeURIComponent(path)}`, "_blank");
  };

  const pathParts = currentPath.split("/").filter(Boolean);

  const navigateTo = (p: string) => setCurrentPath(p || "/");

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  };

  if (editingFile) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-white/5 shrink-0">
          <span className="font-mono text-sm text-primary truncate">{editingFile.path}</span>
          <div className="flex gap-2">
            <button
              onClick={() => writeFile.mutate({ path: editingFile.path, content: editContent })}
              disabled={writeFile.isPending}
              className="px-3 py-1 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
            >
              {writeFile.isPending ? "Saving..." : "Save"}
            </button>
            <button
              onClick={() => setEditingFile(null)}
              className="px-3 py-1 bg-white/5 hover:bg-white/10 text-muted-foreground rounded-lg text-xs transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
        <textarea
          value={editContent}
          onChange={e => setEditContent(e.target.value)}
          className="flex-1 bg-black/40 text-white/90 font-mono text-sm p-4 resize-none focus:outline-none"
          spellCheck={false}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <input
        ref={uploadInputRef}
        type="file"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0];
          if (file) uploadFile.mutate(file);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-1 px-4 py-3 border-b border-white/10 bg-white/5 shrink-0 overflow-x-auto custom-scrollbar">
        <button onClick={() => navigateTo("/")} className="text-primary hover:text-primary/80 font-mono text-sm shrink-0">/</button>
        {pathParts.map((part, i) => {
          const to = "/" + pathParts.slice(0, i + 1).join("/");
          return (
            <span key={to} className="flex items-center gap-1 shrink-0">
              <ChevronRight className="w-3 h-3 text-white/30" />
              <button onClick={() => navigateTo(to)} className="text-primary hover:text-primary/80 font-mono text-sm">{part}</button>
            </span>
          );
        })}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => uploadInputRef.current?.click()}
            disabled={uploadFile.isPending}
            title="Upload file to current directory"
            className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-primary/10 hover:bg-primary/20 text-primary text-xs font-medium transition-colors disabled:opacity-50"
          >
            <Upload className="w-3.5 h-3.5" />
            {uploadFile.isPending ? "Uploading..." : "Upload"}
          </button>
          <button onClick={() => refetch()} className="p-1 rounded hover:bg-white/10 text-muted-foreground hover:text-white transition-colors">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {isLoading && <div className="p-8 text-center text-primary font-mono animate-pulse">READING FILESYSTEM...</div>}
        {error && <div className="p-8 text-center text-red-400 font-mono text-sm">{(error as Error).message}<br />Connect VPS in Settings.</div>}
        {entries && (
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-muted-foreground font-mono text-[10px] uppercase sticky top-0">
              <tr>
                <th className="px-4 py-2 text-left">Name</th>
                <th className="px-4 py-2 text-left hidden md:table-cell">Size</th>
                <th className="px-4 py-2 text-left hidden md:table-cell">Modified</th>
                <th className="px-4 py-2 text-left">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {currentPath !== "/" && (
                <tr className="hover:bg-white/5 cursor-pointer" onClick={() => {
                  const parent = currentPath.split("/").slice(0, -1).join("/") || "/";
                  navigateTo(parent);
                }}>
                  <td className="px-4 py-2 text-white/60 font-mono flex items-center gap-2">
                    <Folder className="w-4 h-4 text-yellow-400/60" /> ..
                  </td>
                  <td className="px-4 py-2 hidden md:table-cell" />
                  <td className="px-4 py-2 hidden md:table-cell" />
                  <td className="px-4 py-2" />
                </tr>
              )}
              {entries
                .sort((a, b) => (a.type === "directory" ? -1 : 1) - (b.type === "directory" ? -1 : 1) || a.name.localeCompare(b.name))
                .map(entry => (
                  <tr key={entry.path} className="hover:bg-white/5 group">
                    <td className="px-4 py-2">
                      <button
                        className="flex items-center gap-2 text-white/80 hover:text-white transition-colors"
                        onClick={() => entry.type === "directory" ? navigateTo(entry.path) : readFile.mutate(entry.path)}
                      >
                        {entry.type === "directory"
                          ? <Folder className="w-4 h-4 text-yellow-400 shrink-0" />
                          : <FileText className="w-4 h-4 text-primary/60 shrink-0" />
                        }
                        <span className="font-mono text-sm truncate">{entry.name}</span>
                      </button>
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs hidden md:table-cell">
                      {entry.type === "file" ? formatSize(entry.size) : "--"}
                    </td>
                    <td className="px-4 py-2 text-muted-foreground font-mono text-xs hidden md:table-cell">
                      {new Date(entry.modifiedAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-2">
                      {entry.type === "file" && (
                        <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all">
                          <button
                            onClick={() => readFile.mutate(entry.path)}
                            title="Edit"
                            className="px-2 py-1 text-[10px] font-mono bg-primary/10 hover:bg-primary/20 text-primary rounded transition-colors"
                          >
                            EDIT
                          </button>
                          <button
                            onClick={() => downloadFile(entry.path)}
                            title="Download"
                            className="p-1.5 rounded bg-white/5 hover:bg-white/10 text-muted-foreground hover:text-white transition-colors"
                          >
                            <Download className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Delete ${entry.name}?`)) {
                                deleteFile.mutate(entry.path);
                              }
                            }}
                            disabled={deleteFile.isPending}
                            title="Delete"
                            className="p-1.5 rounded bg-red-500/10 hover:bg-red-500/20 text-red-400 transition-colors disabled:opacity-40"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

const COMMON_LOGS = [
  { label: "Syslog", path: "/var/log/syslog" },
  { label: "Auth", path: "/var/log/auth.log" },
  { label: "Nginx Access", path: "/var/log/nginx/access.log" },
  { label: "Nginx Error", path: "/var/log/nginx/error.log" },
  { label: "Kernel", path: "/var/log/kern.log" },
];

function LogsView() {
  const [selectedLog, setSelectedLog] = useState("/var/log/syslog");
  const [lines, setLines] = useState<string[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const startStream = useCallback((logPath: string) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
    setLines([]);
    setError(null);
    setIsStreaming(true);

    const url = `/api/vps/logs?path=${encodeURIComponent(logPath)}&lines=100`;
    const es = new EventSource(url);
    eventSourceRef.current = es;

    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { line?: string; error?: string };
        if (data.error) {
          setError(data.error);
          setIsStreaming(false);
          es.close();
        } else if (data.line) {
          setLines(prev => [...prev.slice(-500), data.line!]);
        }
      } catch {}
    };

    es.onerror = () => {
      setIsStreaming(false);
      es.close();
      eventSourceRef.current = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [lines]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3 border-b border-white/10 bg-white/5 shrink-0">
        <select
          value={selectedLog}
          onChange={e => setSelectedLog(e.target.value)}
          className="bg-black/40 border border-white/10 text-white text-sm rounded-lg px-3 py-1.5 font-mono focus:outline-none focus:ring-1 focus:ring-primary"
        >
          {COMMON_LOGS.map(l => (
            <option key={l.path} value={l.path}>{l.label}</option>
          ))}
        </select>
        <button
          onClick={() => startStream(selectedLog)}
          disabled={isStreaming}
          className="px-4 py-1.5 bg-primary/20 hover:bg-primary/30 text-primary rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-2"
        >
          {isStreaming ? (
            <><span className="w-2 h-2 rounded-full bg-primary animate-pulse" /> STREAMING</>
          ) : (
            <><Play className="w-4 h-4" /> Start Tail</>
          )}
        </button>
        {isStreaming && (
          <button
            onClick={() => {
              eventSourceRef.current?.close();
              setIsStreaming(false);
            }}
            className="px-4 py-1.5 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg text-sm font-medium transition-colors"
          >
            Stop
          </button>
        )}
        <span className="text-muted-foreground font-mono text-xs ml-auto">{lines.length} lines</span>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar bg-black/30 p-4 font-mono text-xs">
        {error && <p className="text-red-400">{error}</p>}
        {!isStreaming && lines.length === 0 && (
          <p className="text-muted-foreground">Select a log and click "Start Tail" to begin streaming.</p>
        )}
        {lines.map((line, i) => (
          <div key={i} className="text-white/70 hover:text-white/90 py-0.5 leading-relaxed break-all">
            {line}
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}
