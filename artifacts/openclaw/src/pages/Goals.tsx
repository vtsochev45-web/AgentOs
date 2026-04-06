import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Target, Plus, X, Play, Pause, Trash2, CheckCircle2, Clock, AlertTriangle,
  ChevronDown, ChevronRight, Bot, Loader2, Calendar,
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";

interface GoalStep {
  id: number; stepOrder: number; description: string; status: string; result: string | null; completedAt: string | null;
}
interface Goal {
  id: number; agentId: number; title: string; description: string | null; successCriteria: string | null;
  status: string; priority: string; progress: number; createdAt: string; updatedAt: string; deadline: string | null;
  steps?: GoalStep[];
}
interface Agent { id: number; name: string }

export default function Goals() {
  const [goals, setGoals] = useState<Goal[]>([]);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [expandedGoal, setExpandedGoal] = useState<(Goal & { steps: GoalStep[] }) | null>(null);

  // Form state
  const [form, setForm] = useState({ agentId: 0, title: "", description: "", successCriteria: "", deadline: "" });

  const load = async () => {
    try {
      const [gRes, aRes] = await Promise.all([apiFetch("/api/goals"), apiFetch("/api/agents")]);
      if (gRes.ok) setGoals(await gRes.json());
      if (aRes.ok) setAgents(await aRes.json());
    } catch {}
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const expandGoal = async (id: number) => {
    if (expanded === id) { setExpanded(null); setExpandedGoal(null); return; }
    setExpanded(id);
    try {
      const r = await apiFetch(`/api/goals/${id}`);
      if (r.ok) setExpandedGoal(await r.json());
    } catch {}
  };

  const createGoal = async () => {
    if (!form.agentId || !form.title) return;
    setCreating(false);
    const r = await apiFetch("/api/goals", {
      method: "POST",
      body: JSON.stringify({
        agentId: form.agentId,
        title: form.title,
        description: form.description || undefined,
        successCriteria: form.successCriteria || undefined,
        deadline: form.deadline || undefined,
      }),
    });
    if (r.ok) { setForm({ agentId: 0, title: "", description: "", successCriteria: "", deadline: "" }); load(); }
  };

  const updateGoal = async (id: number, updates: Record<string, string>) => {
    await apiFetch(`/api/goals/${id}`, { method: "PATCH", body: JSON.stringify(updates) });
    load();
  };

  const deleteGoal = async (id: number) => {
    await apiFetch(`/api/goals/${id}`, { method: "DELETE" });
    load();
  };

  const executeStep = async (id: number) => {
    await apiFetch(`/api/goals/${id}/execute`, { method: "POST" });
    setTimeout(load, 2000);
  };

  const statusIcon = (s: string) => {
    if (s === "active") return <Loader2 className="w-4 h-4 text-primary animate-spin" />;
    if (s === "completed") return <CheckCircle2 className="w-4 h-4 text-green-400" />;
    if (s === "paused") return <Pause className="w-4 h-4 text-yellow-400" />;
    if (s === "failed") return <AlertTriangle className="w-4 h-4 text-red-400" />;
    return <Clock className="w-4 h-4 text-white/40" />;
  };

  const stepStatusColor = (s: string) => {
    if (s === "done") return "text-green-400";
    if (s === "running") return "text-primary";
    if (s === "failed") return "text-red-400";
    return "text-white/40";
  };

  const priorityBadge = (p: string) => {
    const colors: Record<string, string> = { urgent: "bg-red-500/20 text-red-400", high: "bg-orange-500/20 text-orange-400", normal: "bg-white/5 text-white/50", low: "bg-white/5 text-white/30" };
    return <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${colors[p] || colors.normal}`}>{p}</span>;
  };

  const agentName = (id: number) => agents.find(a => a.id === id)?.name || "Agent";

  if (loading) return <div className="max-w-5xl mx-auto p-8"><div className="animate-pulse space-y-4">{[1,2,3].map(i => <div key={i} className="h-24 bg-white/5 rounded-2xl" />)}</div></div>;

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col">
      <header className="mb-6 flex justify-between items-end shrink-0">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
            <Target className="w-8 h-8 text-primary" /> Goals
          </h1>
          <p className="text-muted-foreground mt-2 text-sm">Persistent objectives that agents work toward autonomously.</p>
        </div>
        <button onClick={() => setCreating(true)} className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 flex items-center gap-2">
          <Plus className="w-5 h-5" /> New Goal
        </button>
      </header>

      <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar pb-8">
        {goals.length === 0 ? (
          <div className="glass-panel rounded-2xl p-12 text-center">
            <Target className="w-12 h-12 text-white/20 mx-auto mb-4" />
            <p className="text-muted-foreground">No goals yet. Create one to get your agents working autonomously.</p>
          </div>
        ) : goals.map(g => (
          <div key={g.id} className="glass-panel rounded-2xl overflow-hidden">
            <div className="flex items-center gap-3 p-4 cursor-pointer select-none hover:bg-white/5" onClick={() => expandGoal(g.id)}>
              {statusIcon(g.status)}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-white font-semibold text-sm truncate">{g.title}</span>
                  {priorityBadge(g.priority || "normal")}
                </div>
                <div className="flex items-center gap-3 mt-1">
                  <div className="flex items-center gap-1"><Bot className="w-3 h-3 text-primary" /><span className="text-xs text-white/50">{agentName(g.agentId)}</span></div>
                  {g.deadline && <div className="flex items-center gap-1"><Calendar className="w-3 h-3 text-white/30" /><span className="text-xs text-white/30">{format(new Date(g.deadline), "MMM d")}</span></div>}
                  <span className="text-xs text-white/30">{formatDistanceToNow(new Date(g.createdAt), { addSuffix: true })}</span>
                </div>
              </div>
              {/* Progress bar */}
              <div className="w-24 shrink-0">
                <div className="flex justify-between text-[10px] text-white/40 mb-1"><span>{g.progress}%</span></div>
                <div className="h-1.5 bg-white/5 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full transition-all ${g.progress >= 100 ? "bg-green-400" : "bg-primary"}`} style={{ width: `${g.progress}%` }} />
                </div>
              </div>
              {/* Controls */}
              <div className="flex items-center gap-1 shrink-0">
                {g.status === "active" && <button onClick={e => { e.stopPropagation(); updateGoal(g.id, { status: "paused" }); }} className="p-1.5 rounded-lg hover:bg-white/10 text-yellow-400" title="Pause"><Pause className="w-3.5 h-3.5" /></button>}
                {g.status === "paused" && <button onClick={e => { e.stopPropagation(); updateGoal(g.id, { status: "active" }); }} className="p-1.5 rounded-lg hover:bg-white/10 text-green-400" title="Resume"><Play className="w-3.5 h-3.5" /></button>}
                {g.status === "active" && <button onClick={e => { e.stopPropagation(); executeStep(g.id); }} className="p-1.5 rounded-lg hover:bg-white/10 text-primary" title="Execute next step"><Play className="w-3.5 h-3.5" /></button>}
                <button onClick={e => { e.stopPropagation(); deleteGoal(g.id); }} className="p-1.5 rounded-lg hover:bg-white/10 text-red-400/50 hover:text-red-400" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                {expanded === g.id ? <ChevronDown className="w-4 h-4 text-white/30" /> : <ChevronRight className="w-4 h-4 text-white/30" />}
              </div>
            </div>

            {/* Expanded steps */}
            {expanded === g.id && expandedGoal && (
              <div className="border-t border-white/5 px-4 py-3 bg-black/20 space-y-1.5">
                {g.description && <p className="text-xs text-white/50 mb-2">{g.description}</p>}
                {expandedGoal.steps?.map(s => (
                  <div key={s.id} className="flex items-start gap-2 py-1.5">
                    <span className={`text-xs font-mono w-5 text-right shrink-0 ${stepStatusColor(s.status)}`}>{s.stepOrder}.</span>
                    <div className="flex-1 min-w-0">
                      <span className={`text-xs ${s.status === "done" ? "text-white/70 line-through" : s.status === "running" ? "text-primary" : "text-white/60"}`}>{s.description}</span>
                      {s.result && <p className="text-[10px] text-white/30 mt-0.5 truncate">{s.result.substring(0, 120)}</p>}
                    </div>
                    <span className={`text-[10px] uppercase font-bold ${stepStatusColor(s.status)}`}>{s.status}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Create Dialog */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-panel w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl">
            <div className="flex justify-between items-center p-6 border-b border-white/10 bg-white/5">
              <h2 className="text-xl font-bold text-white">Create Goal</h2>
              <button onClick={() => setCreating(false)} className="text-muted-foreground hover:text-white"><X className="w-6 h-6" /></button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="text-sm font-medium text-white block mb-1">Agent</label>
                <select value={form.agentId} onChange={e => setForm(f => ({ ...f, agentId: Number(e.target.value) }))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white">
                  <option value={0}>Select agent...</option>
                  {agents.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </div>
              <div>
                <label className="text-sm font-medium text-white block mb-1">Goal</label>
                <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white" placeholder="e.g., Monitor server uptime and fix issues" />
              </div>
              <div>
                <label className="text-sm font-medium text-white block mb-1">Description (optional)</label>
                <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} rows={2} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white resize-none" placeholder="More context about what this goal involves..." />
              </div>
              <div>
                <label className="text-sm font-medium text-white block mb-1">Success Criteria (optional)</label>
                <input value={form.successCriteria} onChange={e => setForm(f => ({ ...f, successCriteria: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white" placeholder="e.g., 99.9% uptime over 7 days" />
              </div>
              <div>
                <label className="text-sm font-medium text-white block mb-1">Deadline (optional)</label>
                <input type="date" value={form.deadline} onChange={e => setForm(f => ({ ...f, deadline: e.target.value }))} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-white" />
              </div>
              <div className="pt-2 flex justify-end gap-3">
                <button onClick={() => setCreating(false)} className="px-5 py-2.5 rounded-xl text-muted-foreground hover:text-white">Cancel</button>
                <button onClick={createGoal} disabled={!form.agentId || !form.title} className="bg-primary hover:bg-primary/90 disabled:opacity-50 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold">Create Goal</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
