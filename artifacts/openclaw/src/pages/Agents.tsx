import { useState } from "react";
import { useListAgents, useCreateAgent } from "@workspace/api-client-react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { AgentStatusBadge } from "@/components/ui/AgentStatusBadge";
import { Bot, Plus, X, Search, Terminal, Code, MessageSquare } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { getListAgentsQueryKey } from "@workspace/api-client-react";

const createSchema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  persona: z.string().min(10, "Describe the persona in more detail"),
  toolsEnabled: z.array(z.string()).min(1, "Select at least one tool"),
});

const AVAILABLE_TOOLS = [
  { id: "web_search", label: "Web Search", icon: Search },
  { id: "vps_shell", label: "VPS Shell", icon: Terminal },
  { id: "code_exec", label: "Code Exec", icon: Code },
  { id: "send_email", label: "Email/Messaging", icon: MessageSquare },
];

export default function Agents() {
  const { data: agents, isLoading } = useListAgents();
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  
  const createMutation = useCreateAgent({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAgentsQueryKey() });
        setIsCreateOpen(false);
        form.reset();
      }
    }
  });

  const form = useForm<z.infer<typeof createSchema>>({
    resolver: zodResolver(createSchema),
    defaultValues: { name: "", persona: "", toolsEnabled: ["web_search"] }
  });

  const onSubmit = (data: z.infer<typeof createSchema>) => {
    createMutation.mutate({ data });
  };

  return (
    <div className="max-w-6xl mx-auto h-full flex flex-col relative">
      <header className="mb-6 flex justify-between items-end">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Bot className="w-8 h-8 text-primary" />
            Agent Roster
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Deploy and manage your autonomous workforce.</p>
        </div>
        <button 
          onClick={() => setIsCreateOpen(true)}
          className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all flex items-center gap-2"
        >
          <Plus className="w-5 h-5" /> Deploy New
        </button>
      </header>

      {isLoading ? (
        <div className="flex-1 flex items-center justify-center">
          <div className="w-10 h-10 border-4 border-primary border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 auto-rows-max">
          {agents?.map(agent => (
            <Link key={agent.id} href={`/agents/${agent.id}`} className="glass-panel p-6 rounded-2xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-primary/10 hover:border-primary/30 transition-all cursor-pointer group flex flex-col h-[220px]">
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-xl font-bold text-white group-hover:text-primary transition-colors truncate pr-2">{agent.name}</h3>
                <AgentStatusBadge status={agent.status} />
              </div>
              <p className="text-sm text-muted-foreground flex-1 overflow-hidden line-clamp-3 leading-relaxed">
                {agent.persona}
              </p>
              <div className="mt-4 pt-4 border-t border-white/5 flex gap-2 overflow-x-auto custom-scrollbar pb-1">
                {agent.toolsEnabled.map(t => (
                  <span key={t} className="px-2 py-1 bg-white/5 rounded-md text-[10px] uppercase tracking-wide font-mono text-white/70 whitespace-nowrap">
                    {t.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </Link>
          ))}
        </div>
      )}

      {/* Create Dialog Overlay */}
      {isCreateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl animate-in fade-in zoom-in-95 duration-200">
            <div className="flex justify-between items-center p-6 border-b border-white/10 bg-white/5">
              <h2 className="text-xl font-bold text-white">Initialize Agent</h2>
              <button onClick={() => setIsCreateOpen(false)} className="text-muted-foreground hover:text-white transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-6">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white">Designation (Name)</label>
                <input 
                  {...form.register("name")}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all"
                  placeholder="e.g. SysAdmin-01"
                />
                {form.formState.errors.name && <p className="text-red-400 text-xs mt-1">{form.formState.errors.name.message}</p>}
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium text-white">System Prompt (Persona)</label>
                <textarea 
                  {...form.register("persona")}
                  rows={4}
                  className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all resize-none"
                  placeholder="You are an expert DevOps engineer. Your job is to monitor the VPS and fix issues..."
                />
                {form.formState.errors.persona && <p className="text-red-400 text-xs mt-1">{form.formState.errors.persona.message}</p>}
              </div>

              <div className="space-y-3">
                <label className="text-sm font-medium text-white">Authorized Tools</label>
                <div className="grid grid-cols-2 gap-3">
                  {AVAILABLE_TOOLS.map(tool => {
                    const isSelected = form.watch("toolsEnabled").includes(tool.id);
                    const ToolIcon = tool.icon;
                    return (
                      <div 
                        key={tool.id}
                        onClick={() => {
                          const current = form.watch("toolsEnabled");
                          const next = isSelected ? current.filter(t => t !== tool.id) : [...current, tool.id];
                          form.setValue("toolsEnabled", next, { shouldValidate: true });
                        }}
                        className={`flex items-center gap-3 p-3 rounded-xl border cursor-pointer transition-all ${isSelected ? 'bg-primary/20 border-primary text-white' : 'bg-black/20 border-white/10 text-muted-foreground hover:bg-white/5'}`}
                      >
                        <ToolIcon className={`w-5 h-5 ${isSelected ? 'text-primary' : ''}`} />
                        <span className="text-sm font-medium">{tool.label}</span>
                      </div>
                    );
                  })}
                </div>
                {form.formState.errors.toolsEnabled && <p className="text-red-400 text-xs mt-1">{form.formState.errors.toolsEnabled.message}</p>}
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsCreateOpen(false)} className="px-5 py-2.5 rounded-xl font-medium text-muted-foreground hover:text-white transition-colors">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={createMutation.isPending}
                  className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 transition-all flex items-center gap-2"
                >
                  {createMutation.isPending ? 'Deploying...' : 'Deploy Agent'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
