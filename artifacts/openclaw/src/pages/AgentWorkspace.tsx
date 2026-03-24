import { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetAgent,
  useListAgentConversations,
  useGetConversation,
  useListAgentMessages,
  getGetConversationQueryKey,
} from "@workspace/api-client-react";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { useSSEChat } from "@/hooks/use-sse";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  ArrowLeft,
  Send,
  Sparkles,
  ServerCrash,
  Bot,
  GitBranch,
  FileText,
  MessageSquare,
  ArrowUpRight,
  ArrowDownLeft,
  Globe2,
  Play,
  RefreshCw,
  CheckCircle,
  XCircle,
  Loader2,
  ChevronRight,
  Folder,
  Save,
  Rocket,
} from "lucide-react";
import { apiFetch } from "@/lib/api";
import { formatDistanceToNow } from "date-fns";

type WorkspaceTab = "chat" | "delegation" | "files" | "website";

interface AgentFileRow {
  id: number;
  path: string;
  content: string;
  updatedAt: string;
}

export default function AgentWorkspace() {
  const [, params] = useRoute("/agents/:id");
  const agentId = parseInt(params?.id || "0", 10);

  const { data: agent } = useGetAgent(agentId);
  const { data: conversations, refetch: refetchConvos } = useListAgentConversations(agentId);
  const { data: agentMessages, refetch: refetchMessages2 } = useListAgentMessages(agentId);

  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>("chat");
  const [agentFiles, setAgentFiles] = useState<AgentFileRow[]>([]);
  const [selectedFile, setSelectedFile] = useState<AgentFileRow | null>(null);

  /* ── Website tab state ─────────────────────────────────────── */
  interface WebsiteConfig {
    id?: number; type?: string; repoUrl?: string | null; branch?: string;
    vpsDirectory?: string | null; siteUrl?: string | null;
    buildCommand?: string | null; deployCommand?: string | null;
  }
  interface SiteHealth { ok: boolean; status?: number; latencyMs?: number; title?: string | null; error?: string; url?: string }
  interface GitInfo { branch?: string | null; commit?: string | null; commitMessage?: string | null; commitAuthor?: string | null; commitAge?: string | null; uncommittedFiles?: number }
  interface VpsFileEntry { name: string; path: string; type: string; size: number; modifiedAt: string }

  const [websiteConfig, setWebsiteConfig] = useState<WebsiteConfig>({});
  const [websiteConfigLoaded, setWebsiteConfigLoaded] = useState(false);
  const [websiteConfigSaving, setWebsiteConfigSaving] = useState(false);
  const [siteHealth, setSiteHealth] = useState<SiteHealth | null>(null);
  const [siteHealthLoading, setSiteHealthLoading] = useState(false);
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [vpsFiles, setVpsFiles] = useState<VpsFileEntry[]>([]);
  const [vpsFilesLoading, setVpsFilesLoading] = useState(false);
  const [currentVpsDir, setCurrentVpsDir] = useState<string | null>(null);
  const [vfsSelectedPath, setVfsSelectedPath] = useState<string | null>(null);
  const [vfsFileContent, setVfsFileContent] = useState<string>("");
  const [vfsFileLoading, setVfsFileLoading] = useState(false);
  const [vfsFileSaving, setVfsFileSaving] = useState(false);
  const [deployLog, setDeployLog] = useState<string[]>([]);
  const [isDeploying, setIsDeploying] = useState(false);
  const [showDeployLog, setShowDeployLog] = useState(false);
  const [websiteView, setWebsiteView] = useState<"overview" | "files" | "editor" | "deploy">("overview");
  const deployLogRef = useRef<HTMLDivElement>(null);

  const loadWebsiteTab = async () => {
    if (websiteConfigLoaded) return;
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website`);
      if (r.ok) {
        const cfg = await r.json() as WebsiteConfig;
        setWebsiteConfig(cfg);
        setCurrentVpsDir(cfg.vpsDirectory ?? null);
      }
    } catch {}
    setWebsiteConfigLoaded(true);
  };

  const checkSiteHealth = async () => {
    setSiteHealthLoading(true);
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website/health`);
      if (r.ok) setSiteHealth(await r.json() as SiteHealth);
    } catch {}
    setSiteHealthLoading(false);
  };

  const loadGitInfo = async () => {
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website/git`);
      if (r.ok) setGitInfo(await r.json() as GitInfo);
    } catch {}
  };

  const loadVpsFiles = async (dir: string) => {
    setVpsFilesLoading(true);
    setVpsFiles([]);
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website/files?path=${encodeURIComponent(dir)}`);
      if (r.ok) {
        const files = await r.json() as VpsFileEntry[];
        setVpsFiles(files.sort((a, b) => (a.type === "directory" ? -1 : 1) - (b.type === "directory" ? -1 : 1) || a.name.localeCompare(b.name)));
        setCurrentVpsDir(dir);
      }
    } catch {}
    setVpsFilesLoading(false);
  };

  const openVfsFile = async (path: string) => {
    setVfsSelectedPath(path);
    setVfsFileLoading(true);
    setVfsFileContent("");
    setWebsiteView("editor");
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website/files/content?path=${encodeURIComponent(path)}`);
      if (r.ok) {
        const data = await r.json() as { content: string };
        setVfsFileContent(data.content);
      }
    } catch {}
    setVfsFileLoading(false);
  };

  const saveVfsFile = async () => {
    if (!vfsSelectedPath) return;
    setVfsFileSaving(true);
    try {
      await apiFetch(`/api/agents/${agentId}/website/files/content`, {
        method: "PUT",
        body: JSON.stringify({ path: vfsSelectedPath, content: vfsFileContent }),
      });
    } catch {}
    setVfsFileSaving(false);
  };

  const saveWebsiteConfig = async () => {
    setWebsiteConfigSaving(true);
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website`, {
        method: "PUT",
        body: JSON.stringify(websiteConfig),
      });
      if (r.ok) {
        const cfg = await r.json() as WebsiteConfig;
        setWebsiteConfig(cfg);
        setCurrentVpsDir(cfg.vpsDirectory ?? null);
      }
    } catch {}
    setWebsiteConfigSaving(false);
  };

  const startDeploy = async () => {
    setIsDeploying(true);
    setDeployLog([]);
    setShowDeployLog(true);
    setWebsiteView("deploy");
    try {
      const r = await apiFetch(`/api/agents/${agentId}/website/deploy`, { method: "POST" });
      if (!r.body) { setIsDeploying(false); return; }
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            try {
              const evt = JSON.parse(line.slice(6)) as { type: string; data: string };
              setDeployLog((prev) => [...prev, evt.data]);
              deployLogRef.current?.scrollTo({ top: deployLogRef.current.scrollHeight });
            } catch {}
          }
        }
      }
    } catch (e) {
      setDeployLog((prev) => [...prev, `Error: ${String(e)}`]);
    }
    setIsDeploying(false);
  };

  useEffect(() => {
    if (activeTab === "website") {
      loadWebsiteTab();
    }
  }, [activeTab, agentId]);

  useEffect(() => {
    if (conversations?.length && !activeConvId) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  useEffect(() => {
    if (activeTab === "files") {
      apiFetch(`/api/agents/${agentId}/files`)
        .then((r) => r.json())
        .then((data: AgentFileRow[]) => setAgentFiles(data))
        .catch(() => setAgentFiles([]));
    }
  }, [activeTab, agentId]);

  const { data: conversationData, refetch: refetchMessages } = useGetConversation(activeConvId || 0, {
    query: { queryKey: getGetConversationQueryKey(activeConvId || 0), enabled: !!activeConvId },
  });

  const { streamChat, isStreaming, stopStream } = useSSEChat();
  const [input, setInput] = useState("");

  interface StreamSource { title: string; url: string; snippet: string; favicon?: string | null }

  const [streamData, setStreamData] = useState<{
    content: string;
    steps: string[];
    sources: StreamSource[];
    followups: string[];
  } | null>(null);

  const [lastFollowups, setLastFollowups] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [conversationData?.messages, streamData]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isStreaming) return;

    const userMsg = input.trim();
    setInput("");
    setLastFollowups([]);
    setStreamData({ content: "", steps: [], sources: [], followups: [] });

    await streamChat(agentId, userMsg, activeConvId, (msg) => {
      setStreamData((prev) => {
        if (!prev) return null;
        const next = { ...prev };
        if (msg.type === "step") next.steps = [...prev.steps, String(msg.data)];
        if (msg.type === "source") next.sources = [...prev.sources, msg.data as unknown as StreamSource];
        if (msg.type === "content") next.content = prev.content + String(msg.data);
        if (msg.type === "followups") {
          const fups = Array.isArray(msg.data) ? (msg.data as string[]) : [];
          next.followups = fups;
          setLastFollowups(fups);
        }
        return next;
      });
    });

    setStreamData(null);
    refetchMessages();
    refetchConvos();
    refetchMessages2();
  };

  if (!agent) return <div className="p-8 text-center text-muted-foreground animate-pulse">Establishing secure link...</div>;

  const TABS: { id: WorkspaceTab; label: string; icon: React.ReactNode }[] = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="w-4 h-4" /> },
    { id: "delegation", label: "Delegation", icon: <GitBranch className="w-4 h-4" /> },
    { id: "files", label: "Files", icon: <FileText className="w-4 h-4" /> },
    { id: "website", label: "Website", icon: <Globe2 className="w-4 h-4" /> },
  ];

  return (
    <div className="h-full flex flex-col md:flex-row gap-6 relative">
      {/* Left Sidebar - Conversations */}
      <div className="hidden md:flex flex-col w-64 glass-panel rounded-2xl overflow-hidden shrink-0">
        <div className="p-4 border-b border-white/10 bg-white/5">
          <Link href="/agents" className="inline-flex items-center gap-2 text-muted-foreground hover:text-white transition-colors text-sm mb-4">
            <ArrowLeft className="w-4 h-4" /> Back to Roster
          </Link>
          <div className="flex justify-between items-center">
            <h2 className="font-bold text-white truncate pr-2">{agent.name}</h2>
            <AgentStatusBadge status={agent.status} />
          </div>
        </div>

        {/* Tab selector */}
        <div className="flex border-b border-white/10">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2 text-xs flex items-center justify-center gap-1 transition-colors ${activeTab === tab.id ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-white"}`}
            >
              {tab.icon}
            </button>
          ))}
        </div>

        {/* Thread list (chat tab only) */}
        {activeTab === "chat" && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            <button
              onClick={() => setActiveConvId(null)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${!activeConvId ? "bg-primary/20 text-white" : "text-muted-foreground hover:bg-white/5"}`}
            >
              + New Thread
            </button>
            {conversations?.map((c) => (
              <button
                key={c.id}
                onClick={() => setActiveConvId(c.id)}
                className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${activeConvId === c.id ? "bg-white/10 text-white font-medium" : "text-muted-foreground hover:bg-white/5"}`}
              >
                {c.title}
              </button>
            ))}
          </div>
        )}

        {/* Delegation log sidebar links */}
        {activeTab === "delegation" && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar text-xs text-muted-foreground">
            <p className="px-3 py-2 text-muted-foreground/60">
              {agentMessages?.length ? `${agentMessages.length} message(s)` : "No delegation messages yet."}
            </p>
          </div>
        )}

        {/* File list sidebar */}
        {activeTab === "files" && (
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {agentFiles.length === 0 ? (
              <p className="px-3 py-2 text-xs text-muted-foreground/60">No files yet.</p>
            ) : (
              agentFiles.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedFile(f)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs font-mono truncate transition-colors ${selectedFile?.id === f.id ? "bg-white/10 text-white font-medium" : "text-muted-foreground hover:bg-white/5"}`}
                >
                  {f.path}
                </button>
              ))
            )}
          </div>
        )}

        {/* Website sidebar */}
        {activeTab === "website" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-1 custom-scrollbar">
            {(["overview", "files", "editor", "deploy"] as const).map((v) => {
              const labels: Record<string, string> = { overview: "Config & Status", files: "File Browser", editor: "File Editor", deploy: "Deploy Log" };
              return (
                <button
                  key={v}
                  onClick={() => setWebsiteView(v)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition-colors flex items-center gap-2 ${websiteView === v ? "bg-primary/20 text-primary font-medium" : "text-muted-foreground hover:bg-white/5 hover:text-white"}`}
                >
                  <ChevronRight className="w-3 h-3" /> {labels[v]}
                </button>
              );
            })}
            <div className="pt-3 border-t border-white/10 mt-3">
              {siteHealth ? (
                <div className={`flex items-center gap-2 px-3 py-2 rounded-lg text-xs ${siteHealth.ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"}`}>
                  {siteHealth.ok ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                  {siteHealth.ok ? `UP · ${siteHealth.latencyMs}ms` : "DOWN"}
                </div>
              ) : (
                <button
                  onClick={() => { void checkSiteHealth(); }}
                  className="w-full px-3 py-2 rounded-lg text-xs text-muted-foreground hover:text-white hover:bg-white/5 transition-colors flex items-center gap-2"
                >
                  <RefreshCw className="w-3 h-3" /> Check Health
                </button>
              )}
              {gitInfo?.branch && (
                <div className="px-3 py-2 text-xs text-muted-foreground font-mono mt-1">
                  <span className="text-yellow-400">⎇ {gitInfo.branch}</span>
                  {gitInfo.commit && <><br /><span className="text-white/40">{gitInfo.commit}</span></>}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main area */}
      <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative">
        {/* Mobile header */}
        <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between md:hidden">
          <div className="flex flex-col">
            <Link href="/agents" className="text-xs text-primary mb-1">← Roster</Link>
            <span className="font-bold text-white">{agent.name}</span>
          </div>
          <AgentStatusBadge status={agent.status} />
        </div>

        {/* Tab bar - mobile */}
        <div className="flex border-b border-white/10 md:hidden">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex-1 py-2.5 text-xs flex items-center justify-center gap-1.5 transition-colors ${activeTab === tab.id ? "text-primary border-b-2 border-primary bg-primary/5" : "text-muted-foreground hover:text-white"}`}
            >
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        {/* CHAT TAB */}
        {activeTab === "chat" && (
          <>
            <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
              {!activeConvId && !streamData && (
                <div className="h-full flex flex-col items-center justify-center text-center opacity-70">
                  <Sparkles className="w-12 h-12 text-primary mb-4" />
                  <h3 className="text-xl font-medium text-white mb-2">Initialize Operation</h3>
                  <p className="text-muted-foreground max-w-sm">Provide a clear objective. The agent will autonomously reason, search, and execute tools to accomplish it.</p>
                </div>
              )}

              {conversationData?.messages.map((msg) => (
                <div key={msg.id} className={`flex gap-4 ${msg.role === "user" ? "justify-end" : ""}`}>
                  {msg.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30 text-primary mt-1">
                      <Bot className="w-4 h-4" />
                    </div>
                  )}
                  <div className={`max-w-[85%] ${msg.role === "user" ? "bg-primary/20 border border-primary/30 text-white px-5 py-3 rounded-2xl rounded-tr-sm" : ""}`}>
                    {msg.role === "user" ? (
                      <div className="whitespace-pre-wrap">{msg.content}</div>
                    ) : (
                      <div className="space-y-4">
                        <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 max-w-none">
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                        </div>
                        {msg.sourcesJson && msg.sourcesJson.length > 0 && (
                          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10">
                            {msg.sourcesJson.map((src, idx) => (
                              <a key={idx} href={src.url} target="_blank" rel="noreferrer" className="block p-3 rounded-xl bg-black/30 border border-white/5 hover:border-primary/40 transition-colors group">
                                <div className="flex items-center gap-2 mb-1">
                                  <div className="w-4 h-4 bg-white/10 rounded flex items-center justify-center text-[10px] text-muted-foreground">{idx + 1}</div>
                                  <span className="text-xs font-medium text-white/80 truncate">{src.title}</span>
                                </div>
                                <p className="text-[10px] text-muted-foreground line-clamp-2">{src.snippet}</p>
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {streamData && (
                <div className="flex gap-4">
                  <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30 text-primary mt-1">
                    <div className="w-2 h-2 bg-primary rounded-full animate-pulse-fast" />
                  </div>
                  <div className="max-w-[85%] space-y-4">
                    {streamData.steps.length > 0 && (
                      <div className="p-3 rounded-xl bg-black/40 border border-white/5 font-mono text-xs text-muted-foreground space-y-2">
                        {streamData.steps.map((step, i) => (
                          <div key={i} className="flex items-start gap-2">
                            <span className="text-primary mt-0.5">&gt;</span>
                            <span>{step}</span>
                          </div>
                        ))}
                        {isStreaming && (
                          <div className="flex gap-1 items-center ml-4 opacity-50">
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: "0ms" }} />
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: "150ms" }} />
                            <span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{ animationDelay: "300ms" }} />
                          </div>
                        )}
                      </div>
                    )}
                    {streamData.content && (
                      <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 max-w-none">
                        <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamData.content}</ReactMarkdown>
                      </div>
                    )}
                    {streamData.sources.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-4">
                        {streamData.sources.map((src, idx) => (
                          <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/30 border border-white/5 text-xs text-white/70">
                            <Globe2 className="w-3 h-3 text-primary" /> [{idx + 1}] {new URL(src.url).hostname.replace("www.", "")}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            <div className="p-4 bg-black/20 border-t border-white/5">
              {!isStreaming && lastFollowups.length > 0 && (
                <div className="flex gap-2 overflow-x-auto mb-4 custom-scrollbar pb-1">
                  {lastFollowups.map((f, i) => (
                    <button
                      key={i}
                      onClick={() => setInput(f)}
                      className="whitespace-nowrap px-4 py-1.5 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs text-primary/80 hover:text-primary transition-colors"
                    >
                      {f}
                    </button>
                  ))}
                </div>
              )}
              <form onSubmit={handleSubmit} className="relative flex items-end gap-2">
                <div className="flex-1 relative bg-white/5 border border-white/10 focus-within:border-primary/50 focus-within:bg-white/10 rounded-2xl transition-all">
                  <textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
                    }}
                    placeholder={isStreaming ? "Agent is working..." : "Instruct the agent..."}
                    className="w-full bg-transparent text-white px-4 py-3.5 focus:outline-none resize-none min-h-[52px] max-h-[200px]"
                    rows={1}
                    disabled={isStreaming}
                  />
                  <div className="absolute right-3 top-3 text-xs text-muted-foreground font-mono hidden sm:block pointer-events-none">
                    {isStreaming ? "PROCESSING" : "SHIFT+ENTER TO NEWLINE"}
                  </div>
                </div>
                {isStreaming ? (
                  <button type="button" onClick={stopStream} className="p-3.5 rounded-xl bg-red-500/20 text-red-500 hover:bg-red-500/30 border border-red-500/30 transition-colors h-[52px]">
                    <ServerCrash className="w-5 h-5" />
                  </button>
                ) : (
                  <button type="submit" disabled={!input.trim()} className="p-3.5 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-primary/20 h-[52px]">
                    <Send className="w-5 h-5" />
                  </button>
                )}
              </form>
            </div>
          </>
        )}

        {/* DELEGATION TAB */}
        {activeTab === "delegation" && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
            <div className="flex items-center gap-2 mb-6">
              <GitBranch className="w-5 h-5 text-cyan-400" />
              <h3 className="text-lg font-semibold text-white">Delegation Threads</h3>
              <span className="text-xs text-muted-foreground ml-auto font-mono">Sent + Received</span>
            </div>
            {!agentMessages?.length ? (
              <div className="flex flex-col items-center justify-center text-center py-20 opacity-60">
                <GitBranch className="w-10 h-10 text-muted-foreground mb-4" />
                <p className="text-muted-foreground">No delegation messages yet. Agents with the "delegate_to_agent" tool will appear here.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {agentMessages.map((msg) => {
                  const isSent = msg.fromAgentId === agentId;
                  return (
                    <div key={msg.id} className={`p-4 rounded-xl border ${isSent ? "bg-cyan-400/5 border-cyan-400/20" : "bg-white/5 border-white/10"}`}>
                      <div className="flex items-center gap-2 mb-2">
                        {isSent ? (
                          <><ArrowUpRight className="w-4 h-4 text-cyan-400" /><span className="text-xs font-semibold text-cyan-400">SENT TO AGENT {msg.toAgentId}</span></>
                        ) : (
                          <><ArrowDownLeft className="w-4 h-4 text-green-400" /><span className="text-xs font-semibold text-green-400">RECEIVED FROM AGENT {msg.fromAgentId}</span></>
                        )}
                        <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                          {msg.timestamp ? formatDistanceToNow(new Date(msg.timestamp), { addSuffix: true }) : ""}
                        </span>
                      </div>
                      <p className="text-sm text-white/80 font-mono leading-relaxed p-3 bg-black/30 rounded-lg border border-white/5">
                        {msg.content}
                      </p>
                      {msg.response && (
                        <div className="mt-3 pt-3 border-t border-white/5">
                          <p className="text-xs text-muted-foreground mb-1 flex items-center gap-1"><Bot className="w-3 h-3" /> Response</p>
                          <p className="text-sm text-white/70 leading-relaxed">{msg.response}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* FILES TAB */}
        {activeTab === "files" && (
          <div className="flex-1 flex overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
              <div className="flex items-center gap-2 mb-6">
                <FileText className="w-5 h-5 text-blue-400" />
                <h3 className="text-lg font-semibold text-white">File Workspace</h3>
                <span className="text-xs text-muted-foreground ml-auto font-mono">{agentFiles.length} file(s)</span>
              </div>
              {agentFiles.length === 0 ? (
                <div className="flex flex-col items-center justify-center text-center py-20 opacity-60">
                  <FileText className="w-10 h-10 text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No files yet. Agents with file_read/file_write tools will create files here.</p>
                </div>
              ) : selectedFile ? (
                <div className="space-y-4">
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelectedFile(null)} className="text-xs text-primary hover:underline">← All Files</button>
                    <span className="text-white font-mono text-sm">{selectedFile.path}</span>
                    <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                      {selectedFile.updatedAt ? formatDistanceToNow(new Date(selectedFile.updatedAt), { addSuffix: true }) : ""}
                    </span>
                  </div>
                  <pre className="bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white/80 font-mono overflow-x-auto custom-scrollbar whitespace-pre-wrap break-words">
                    {selectedFile.content || "(empty)"}
                  </pre>
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {agentFiles.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => setSelectedFile(f)}
                      className="text-left p-4 rounded-xl bg-black/30 border border-white/10 hover:border-blue-400/40 transition-colors group"
                    >
                      <div className="flex items-start gap-2">
                        <FileText className="w-4 h-4 text-blue-400 mt-0.5 shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm text-white font-mono truncate group-hover:text-blue-400 transition-colors">{f.path}</p>
                          <p className="text-[10px] text-muted-foreground mt-1">
                            {f.content.length} chars · {f.updatedAt ? formatDistanceToNow(new Date(f.updatedAt), { addSuffix: true }) : ""}
                          </p>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* WEBSITE TAB */}
        {activeTab === "website" && (
          <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">

            {/* ── Overview: Config + Status ── */}
            {websiteView === "overview" && (
              <div className="space-y-6">
                {/* Header */}
                <div className="flex items-center gap-3">
                  <Globe2 className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-white">Website Management</h3>
                  <button
                    onClick={startDeploy}
                    disabled={isDeploying}
                    className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium shadow-lg shadow-primary/20 transition-colors"
                  >
                    {isDeploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    {isDeploying ? "Deploying…" : "Deploy Now"}
                  </button>
                </div>

                {/* Site status card */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-black/30 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Site Health</span>
                      <button
                        onClick={() => { void checkSiteHealth(); }}
                        disabled={siteHealthLoading}
                        className="p-1 rounded-md text-muted-foreground hover:text-white transition-colors"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${siteHealthLoading ? "animate-spin" : ""}`} />
                      </button>
                    </div>
                    {siteHealth ? (
                      <>
                        <div className={`flex items-center gap-2 text-lg font-bold ${siteHealth.ok ? "text-green-400" : "text-red-400"}`}>
                          {siteHealth.ok ? <CheckCircle className="w-5 h-5" /> : <XCircle className="w-5 h-5" />}
                          {siteHealth.ok ? "UP" : "DOWN"}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">
                          HTTP {siteHealth.status} · {siteHealth.latencyMs}ms
                          {siteHealth.title && <span className="block mt-0.5 text-white/60 truncate">{siteHealth.title}</span>}
                        </div>
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground/60">Not checked yet</p>
                    )}
                    {websiteConfig.siteUrl && (
                      <a href={websiteConfig.siteUrl} target="_blank" rel="noreferrer" className="mt-3 flex items-center gap-1 text-xs text-primary hover:underline truncate">
                        <Globe2 className="w-3 h-3" /> {websiteConfig.siteUrl}
                      </a>
                    )}
                  </div>
                  <div className="p-4 rounded-xl bg-black/30 border border-white/10">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-xs text-muted-foreground font-medium uppercase tracking-wider">Git Info</span>
                      <button
                        onClick={() => { void loadGitInfo(); }}
                        className="p-1 rounded-md text-muted-foreground hover:text-white transition-colors"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {gitInfo ? (
                      <>
                        <div className="flex items-center gap-2 text-yellow-400 font-mono text-sm">
                          <GitBranch className="w-4 h-4" /> {gitInfo.branch ?? "unknown"}
                        </div>
                        {gitInfo.commitMessage && (
                          <p className="mt-1 text-xs text-white/70 line-clamp-2">{gitInfo.commitMessage}</p>
                        )}
                        {gitInfo.commitAge && (
                          <p className="mt-1 text-[10px] text-muted-foreground">{gitInfo.commitAge}</p>
                        )}
                        {(gitInfo.uncommittedFiles ?? 0) > 0 && (
                          <p className="mt-1.5 text-[10px] text-orange-400">{gitInfo.uncommittedFiles} uncommitted file(s)</p>
                        )}
                      </>
                    ) : (
                      <p className="text-sm text-muted-foreground/60">Click refresh to load</p>
                    )}
                  </div>
                </div>

                {/* Config form */}
                <div className="p-4 rounded-xl bg-black/30 border border-white/10 space-y-4">
                  <h4 className="text-sm font-semibold text-white">Configuration</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Type</label>
                      <select
                        value={websiteConfig.type ?? "vps-path"}
                        onChange={(e) => setWebsiteConfig((p) => ({ ...p, type: e.target.value }))}
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-primary/50"
                      >
                        <option value="vps-path">VPS Path</option>
                        <option value="git">Git Repo</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Branch</label>
                      <input
                        type="text"
                        value={websiteConfig.branch ?? "main"}
                        onChange={(e) => setWebsiteConfig((p) => ({ ...p, branch: e.target.value }))}
                        placeholder="main"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">VPS Directory</label>
                    <input
                      type="text"
                      value={websiteConfig.vpsDirectory ?? ""}
                      onChange={(e) => setWebsiteConfig((p) => ({ ...p, vpsDirectory: e.target.value }))}
                      placeholder="/var/www/mysite"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Site URL</label>
                    <input
                      type="url"
                      value={websiteConfig.siteUrl ?? ""}
                      onChange={(e) => setWebsiteConfig((p) => ({ ...p, siteUrl: e.target.value }))}
                      placeholder="https://example.com"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50"
                    />
                  </div>
                  {websiteConfig.type === "git" && (
                    <div>
                      <label className="block text-xs text-muted-foreground mb-1">Repo URL</label>
                      <input
                        type="text"
                        value={websiteConfig.repoUrl ?? ""}
                        onChange={(e) => setWebsiteConfig((p) => ({ ...p, repoUrl: e.target.value }))}
                        placeholder="git@github.com:user/repo.git"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 font-mono"
                      />
                    </div>
                  )}
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Build Command</label>
                    <input
                      type="text"
                      value={websiteConfig.buildCommand ?? ""}
                      onChange={(e) => setWebsiteConfig((p) => ({ ...p, buildCommand: e.target.value }))}
                      placeholder="npm run build"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-muted-foreground mb-1">Deploy Command</label>
                    <input
                      type="text"
                      value={websiteConfig.deployCommand ?? ""}
                      onChange={(e) => setWebsiteConfig((p) => ({ ...p, deployCommand: e.target.value }))}
                      placeholder="pm2 restart app  (leave blank to use build only)"
                      className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-muted-foreground/50 focus:outline-none focus:border-primary/50 font-mono"
                    />
                  </div>
                  <button
                    onClick={() => { void saveWebsiteConfig(); }}
                    disabled={websiteConfigSaving}
                    className="flex items-center gap-2 px-4 py-2 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-sm text-white transition-colors"
                  >
                    {websiteConfigSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                    {websiteConfigSaving ? "Saving…" : "Save Config"}
                  </button>
                </div>
              </div>
            )}

            {/* ── File Browser ── */}
            {websiteView === "files" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Folder className="w-5 h-5 text-yellow-400" />
                  <h3 className="text-lg font-semibold text-white">File Browser</h3>
                  <button
                    onClick={() => { const dir = currentVpsDir ?? websiteConfig.vpsDirectory ?? ""; if (dir) { void loadVpsFiles(dir); } }}
                    className="ml-auto p-2 rounded-lg text-muted-foreground hover:text-white hover:bg-white/5 transition-colors"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {!currentVpsDir && !websiteConfig.vpsDirectory ? (
                  <div className="flex flex-col items-center py-20 text-center opacity-60">
                    <Folder className="w-10 h-10 text-muted-foreground mb-4" />
                    <p className="text-muted-foreground text-sm">Configure VPS Directory in the Overview tab first</p>
                  </div>
                ) : (
                  <>
                    {/* breadcrumb */}
                    <div className="flex items-center gap-1 text-xs font-mono text-muted-foreground overflow-x-auto custom-scrollbar pb-1">
                      <button
                        onClick={() => {
                          const rootDir = websiteConfig.vpsDirectory ?? currentVpsDir ?? "";
                          if (rootDir) void loadVpsFiles(rootDir);
                        }}
                        className="hover:text-primary transition-colors shrink-0"
                      >
                        root
                      </button>
                      {currentVpsDir && currentVpsDir !== websiteConfig.vpsDirectory && (
                        <>
                          <ChevronRight className="w-3 h-3 shrink-0" />
                          <span className="text-white truncate">{currentVpsDir}</span>
                        </>
                      )}
                    </div>

                    {vpsFilesLoading ? (
                      <div className="flex items-center justify-center py-10">
                        <Loader2 className="w-6 h-6 animate-spin text-primary" />
                      </div>
                    ) : vpsFiles.length === 0 && !vpsFilesLoading ? (
                      <div className="text-center py-16">
                        <button
                          onClick={() => { const dir = currentVpsDir ?? websiteConfig.vpsDirectory ?? ""; if (dir) void loadVpsFiles(dir); }}
                          className="px-4 py-2 rounded-xl bg-primary/20 text-primary hover:bg-primary/30 transition-colors text-sm"
                        >
                          <Play className="w-4 h-4 inline mr-2" /> Load Files
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        {currentVpsDir && currentVpsDir !== websiteConfig.vpsDirectory && (
                          <button
                            onClick={() => {
                              const parts = currentVpsDir.split("/").filter(Boolean);
                              parts.pop();
                              const parent = "/" + parts.join("/");
                              void loadVpsFiles(parent || websiteConfig.vpsDirectory || "/");
                            }}
                            className="w-full text-left px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-xs text-muted-foreground font-mono transition-colors flex items-center gap-2"
                          >
                            <Folder className="w-3.5 h-3.5" /> ..
                          </button>
                        )}
                        {vpsFiles.map((f) => (
                          <button
                            key={f.path}
                            onClick={() => {
                              if (f.type === "directory") {
                                void loadVpsFiles(f.path);
                              } else {
                                void openVfsFile(f.path);
                              }
                            }}
                            className="w-full text-left px-3 py-2.5 rounded-lg hover:bg-white/5 text-xs font-mono transition-colors flex items-center gap-2 group"
                          >
                            {f.type === "directory" ? (
                              <Folder className="w-3.5 h-3.5 text-yellow-400 shrink-0" />
                            ) : (
                              <FileText className="w-3.5 h-3.5 text-blue-400 shrink-0" />
                            )}
                            <span className="flex-1 truncate text-white/80 group-hover:text-white">{f.name}</span>
                            {f.type === "file" && (
                              <span className="text-muted-foreground/60 shrink-0">{f.size > 1024 ? `${(f.size / 1024).toFixed(1)}KB` : `${f.size}B`}</span>
                            )}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {/* ── File Editor ── */}
            {websiteView === "editor" && (
              <div className="flex flex-col h-full space-y-3">
                <div className="flex items-center gap-3 shrink-0">
                  <button onClick={() => setWebsiteView("files")} className="text-xs text-primary hover:underline">← Files</button>
                  <span className="text-white font-mono text-sm truncate flex-1">{vfsSelectedPath ?? "(no file selected)"}</span>
                  <button
                    onClick={() => { void saveVfsFile(); }}
                    disabled={vfsFileSaving || !vfsSelectedPath}
                    className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-xs font-medium transition-colors"
                  >
                    {vfsFileSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {vfsFileSaving ? "Saving…" : "Save"}
                  </button>
                </div>
                {vfsFileLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 className="w-6 h-6 animate-spin text-primary" />
                  </div>
                ) : !vfsSelectedPath ? (
                  <div className="flex-1 flex items-center justify-center text-center opacity-60">
                    <div>
                      <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                      <p className="text-muted-foreground text-sm">Select a file in the File Browser to edit it</p>
                    </div>
                  </div>
                ) : (
                  <textarea
                    value={vfsFileContent}
                    onChange={(e) => setVfsFileContent(e.target.value)}
                    spellCheck={false}
                    className="flex-1 w-full bg-black/40 border border-white/10 rounded-xl p-4 text-sm text-white font-mono resize-none focus:outline-none focus:border-primary/40 custom-scrollbar"
                  />
                )}
              </div>
            )}

            {/* ── Deploy Log ── */}
            {websiteView === "deploy" && (
              <div className="space-y-4">
                <div className="flex items-center gap-3">
                  <Rocket className="w-5 h-5 text-primary" />
                  <h3 className="text-lg font-semibold text-white">Deploy Log</h3>
                  <button
                    onClick={startDeploy}
                    disabled={isDeploying}
                    className="ml-auto flex items-center gap-2 px-4 py-2 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 text-sm font-medium shadow-lg shadow-primary/20 transition-colors"
                  >
                    {isDeploying ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
                    {isDeploying ? "Deploying…" : "Deploy Now"}
                  </button>
                </div>
                <div
                  ref={deployLogRef}
                  className="bg-black/60 border border-white/10 rounded-xl p-4 font-mono text-xs overflow-y-auto custom-scrollbar space-y-0.5"
                  style={{ minHeight: "300px", maxHeight: "60vh" }}
                >
                  {deployLog.length === 0 ? (
                    <p className="text-muted-foreground/60">No deploy logs yet. Click Deploy Now to start.</p>
                  ) : (
                    deployLog.map((line, i) => (
                      <div
                        key={i}
                        className={`${line.startsWith("✓") ? "text-green-400" : line.startsWith("⚠") ? "text-yellow-400" : line.startsWith("Error") || line.startsWith("✗") ? "text-red-400" : line.startsWith("$") ? "text-primary" : "text-white/70"} whitespace-pre-wrap break-all leading-5`}
                      >
                        {line}
                      </div>
                    ))
                  )}
                  {isDeploying && (
                    <div className="flex items-center gap-2 text-primary mt-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      <span>Deploying…</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
