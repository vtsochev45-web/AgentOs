import { useState, useRef, useEffect } from "react";
import { useRoute, Link } from "wouter";
import { useGetAgent, useListAgentConversations, useGetConversation, getGetConversationQueryKey } from "@workspace/api-client-react";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { useSSEChat } from "@/hooks/use-sse";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, Send, Sparkles, ServerCrash, Globe, Bot } from "lucide-react";

export default function AgentWorkspace() {
  const [, params] = useRoute("/agents/:id");
  const agentId = parseInt(params?.id || "0", 10);
  
  const { data: agent } = useGetAgent(agentId);
  const { data: conversations, refetch: refetchConvos } = useListAgentConversations(agentId);
  
  const [activeConvId, setActiveConvId] = useState<number | null>(null);
  
  // Auto-select latest conversation or keep null for new
  useEffect(() => {
    if (conversations?.length && !activeConvId) {
      setActiveConvId(conversations[0].id);
    }
  }, [conversations, activeConvId]);

  const { data: conversationData, refetch: refetchMessages } = useGetConversation(activeConvId || 0, {
    query: { queryKey: getGetConversationQueryKey(activeConvId || 0), enabled: !!activeConvId }
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
      setStreamData(prev => {
        if (!prev) return null;
        const next = { ...prev };
        if (msg.type === 'step') next.steps = [...prev.steps, String(msg.data)];
        if (msg.type === 'source') next.sources = [...prev.sources, msg.data as unknown as StreamSource];
        if (msg.type === 'content') next.content = prev.content + String(msg.data);
        if (msg.type === 'followups') {
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
  };

  if (!agent) return <div className="p-8 text-center text-muted-foreground animate-pulse">Establishing secure link...</div>;

  return (
    <div className="h-full flex flex-col md:flex-row gap-6 relative">
      {/* Left Sidebar - Chat History */}
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
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          <button 
            onClick={() => setActiveConvId(null)}
            className={`w-full text-left px-3 py-2 rounded-lg text-sm transition-colors ${!activeConvId ? 'bg-primary/20 text-white' : 'text-muted-foreground hover:bg-white/5'}`}
          >
            + New Thread
          </button>
          {conversations?.map(c => (
            <button 
              key={c.id}
              onClick={() => setActiveConvId(c.id)}
              className={`w-full text-left px-3 py-2 rounded-lg text-sm truncate transition-colors ${activeConvId === c.id ? 'bg-white/10 text-white font-medium' : 'text-muted-foreground hover:bg-white/5'}`}
            >
              {c.title}
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col glass-panel rounded-2xl overflow-hidden relative">
        <div className="p-4 border-b border-white/10 bg-white/5 flex items-center justify-between md:hidden">
            <div className="flex flex-col">
               <Link href="/agents" className="text-xs text-primary mb-1">← Roster</Link>
               <span className="font-bold text-white">{agent.name}</span>
            </div>
            <AgentStatusBadge status={agent.status} />
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-6 custom-scrollbar">
          {!activeConvId && !streamData && (
            <div className="h-full flex flex-col items-center justify-center text-center opacity-70">
              <Sparkles className="w-12 h-12 text-primary mb-4" />
              <h3 className="text-xl font-medium text-white mb-2">Initialize Operation</h3>
              <p className="text-muted-foreground max-w-sm">Provide a clear objective. The agent will autonomously reason, search, and execute tools to accomplish it.</p>
            </div>
          )}

          {conversationData?.messages.map(msg => (
            <div key={msg.id} className={`flex gap-4 ${msg.role === 'user' ? 'justify-end' : ''}`}>
              {msg.role === 'assistant' && (
                <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30 text-primary mt-1">
                  <Bot className="w-4 h-4" />
                </div>
              )}
              <div className={`max-w-[85%] ${msg.role === 'user' ? 'bg-primary/20 border border-primary/30 text-white px-5 py-3 rounded-2xl rounded-tr-sm' : ''}`}>
                {msg.role === 'user' ? (
                  <div className="whitespace-pre-wrap">{msg.content}</div>
                ) : (
                  <div className="space-y-4">
                    {/* Perplexity-style Content */}
                    <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 max-w-none">
                      <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                    </div>
                    {/* Source Cards */}
                    {msg.sourcesJson && msg.sourcesJson.length > 0 && (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 mt-4 pt-4 border-t border-white/10">
                        {msg.sourcesJson.map((src, idx) => (
                          <a key={idx} href={src.url} target="_blank" rel="noreferrer" className="block p-3 rounded-xl bg-black/30 border border-white/5 hover:border-primary/40 transition-colors group">
                             <div className="flex items-center gap-2 mb-1">
                               <div className="w-4 h-4 bg-white/10 rounded flex items-center justify-center text-[10px] text-muted-foreground">
                                 {idx + 1}
                               </div>
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

          {/* Streaming Response */}
          {streamData && (
             <div className="flex gap-4">
              <div className="w-8 h-8 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30 text-primary mt-1">
                  <div className="w-2 h-2 bg-primary rounded-full animate-pulse-fast" />
              </div>
              <div className="max-w-[85%] space-y-4">
                {/* Reasoning Steps */}
                {streamData.steps.length > 0 && (
                  <div className="p-3 rounded-xl bg-black/40 border border-white/5 font-mono text-xs text-muted-foreground space-y-2">
                    {streamData.steps.map((step, i) => (
                      <div key={i} className="flex items-start gap-2">
                        <span className="text-primary mt-0.5">&gt;</span>
                        <span>{step}</span>
                      </div>
                    ))}
                    {isStreaming && <div className="flex gap-1 items-center ml-4 opacity-50"><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{animationDelay: '0ms'}}/><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{animationDelay: '150ms'}}/><span className="w-1.5 h-1.5 bg-white rounded-full animate-bounce" style={{animationDelay: '300ms'}}/></div>}
                  </div>
                )}
                
                {/* Content Stream */}
                {streamData.content && (
                  <div className="prose prose-invert prose-p:leading-relaxed prose-pre:bg-black/50 prose-pre:border prose-pre:border-white/10 max-w-none">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{streamData.content}</ReactMarkdown>
                  </div>
                )}

                {/* Sources Stream */}
                {streamData.sources.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-4">
                     {streamData.sources.map((src, idx) => (
                        <div key={idx} className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-black/30 border border-white/5 text-xs text-white/70">
                          <Globe className="w-3 h-3 text-primary" /> [{idx+1}] {new URL(src.url).hostname.replace('www.','')}
                        </div>
                     ))}
                  </div>
                )}
              </div>
             </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Input Area */}
        <div className="p-4 bg-black/20 border-t border-white/5">
          {/* Follow-up suggestions — persisted from last streamed response */}
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
                 onChange={e => setInput(e.target.value)}
                 onKeyDown={e => {
                   if(e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSubmit(e); }
                 }}
                 placeholder={isStreaming ? "Agent is working..." : "Instruct the agent..."}
                 className="w-full bg-transparent text-white px-4 py-3.5 focus:outline-none resize-none min-h-[52px] max-h-[200px]"
                 rows={1}
                 disabled={isStreaming}
               />
               <div className="absolute right-3 top-3 text-xs text-muted-foreground font-mono hidden sm:block pointer-events-none">
                 {isStreaming ? 'PROCESSING' : 'SHIFT+ENTER TO NEWLINE'}
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
      </div>
    </div>
  );
}

