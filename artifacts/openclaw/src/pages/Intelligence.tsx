import { useState, useEffect } from "react";
import { apiFetch } from "@/lib/api";
import {
  Brain, DollarSign, TrendingUp, AlertTriangle, Bot,
  Zap, Clock, MessageSquare, ShieldAlert, ChevronDown, ChevronRight,
} from "lucide-react";
import { format } from "date-fns";

interface CostEntry { agentId: number; agentName: string; model: string; tokensIn: number; tokensOut: number; costCents: number; jobCount: number }
interface CostData { costs: CostEntry[]; totalCents: number; totalJobs: number; days: number }
interface PerfEntry { agentId: number; agentName: string; totalJobs: number; avgDurationMs: number; avgTokensOut: number; errorRate: number; toolSuccessRate: number }
interface Anomaly { agentId: number; agentName: string; metric: string; currentValue: number; avgValue: number; severity: "warning" | "critical"; timestamp: string }
interface DailyCost { date: string; costCents: number; jobs: number }

export default function Intelligence() {
  const [costs, setCosts] = useState<CostData | null>(null);
  const [perf, setPerf] = useState<PerfEntry[]>([]);
  const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
  const [daily, setDaily] = useState<DailyCost[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedCost, setExpandedCost] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const [cRes, pRes, aRes, dRes] = await Promise.all([
          apiFetch("/api/intelligence/costs?days=7"),
          apiFetch("/api/intelligence/performance?days=7"),
          apiFetch("/api/intelligence/anomalies?days=7"),
          apiFetch("/api/intelligence/costs/daily?days=14"),
        ]);
        if (cRes.ok) setCosts(await cRes.json());
        if (pRes.ok) setPerf(await pRes.json());
        if (aRes.ok) setAnomalies(await aRes.json());
        if (dRes.ok) setDaily(await dRes.json());
      } catch {}
      setLoading(false);
    };
    load();
  }, []);

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto p-8">
        <div className="animate-pulse space-y-6">
          {[1,2,3].map(i => <div key={i} className="h-32 bg-white/5 rounded-2xl" />)}
        </div>
      </div>
    );
  }

  const maxDaily = Math.max(...daily.map(d => d.costCents), 0.01);

  return (
    <div className="max-w-5xl mx-auto h-full flex flex-col">
      <header className="mb-8 shrink-0">
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <Brain className="w-8 h-8 text-primary" />
          Intelligence
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Cost tracking, performance scoring, and anomaly detection across all agents.</p>
      </header>

      <div className="flex-1 overflow-y-auto space-y-6 custom-scrollbar pb-8">

        {/* Anomalies Banner */}
        {anomalies.length > 0 && (
          <div className="glass-panel rounded-2xl p-4 border-l-4 border-yellow-500">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-5 h-5 text-yellow-400" />
              <span className="font-semibold text-yellow-400 text-sm">{anomalies.length} Anomal{anomalies.length === 1 ? "y" : "ies"} Detected</span>
            </div>
            <div className="space-y-2">
              {anomalies.map((a, i) => (
                <div key={i} className="flex items-center gap-3 text-sm bg-black/20 rounded-lg p-2.5">
                  <ShieldAlert className={`w-4 h-4 shrink-0 ${a.severity === "critical" ? "text-red-400" : "text-yellow-400"}`} />
                  <Bot className="w-4 h-4 text-primary shrink-0" />
                  <span className="text-white font-medium">{a.agentName}</span>
                  <span className="text-white/60">{a.metric.replace("_", " ")}: {Math.round(a.currentValue)} (avg: {Math.round(a.avgValue)})</span>
                  <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded ${a.severity === "critical" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"}`}>{a.severity}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost Summary Cards */}
        <div className="grid grid-cols-3 gap-4">
          <div className="glass-panel rounded-2xl p-5 text-center">
            <DollarSign className="w-6 h-6 text-green-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-white">${((costs?.totalCents || 0) / 100).toFixed(4)}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Cost (7d)</div>
          </div>
          <div className="glass-panel rounded-2xl p-5 text-center">
            <MessageSquare className="w-6 h-6 text-blue-400 mx-auto mb-2" />
            <div className="text-2xl font-bold text-white">{costs?.totalJobs || 0}</div>
            <div className="text-xs text-muted-foreground mt-1">Total Jobs (7d)</div>
          </div>
          <div className="glass-panel rounded-2xl p-5 text-center">
            <Bot className="w-6 h-6 text-primary mx-auto mb-2" />
            <div className="text-2xl font-bold text-white">{perf.length}</div>
            <div className="text-xs text-muted-foreground mt-1">Active Agents</div>
          </div>
        </div>

        {/* Daily Cost Chart (simple bar chart) */}
        {daily.length > 0 && (
          <div className="glass-panel rounded-2xl p-5">
            <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-primary" /> Daily Cost Trend (14d)
            </h2>
            <div className="flex items-end gap-1 h-24">
              {daily.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <div
                    className="w-full bg-primary/60 rounded-t hover:bg-primary transition-colors"
                    style={{ height: `${Math.max((d.costCents / maxDaily) * 80, 2)}px` }}
                    title={`${d.date}: $${(d.costCents / 100).toFixed(4)} (${d.jobs} jobs)`}
                  />
                  <span className="text-[8px] text-muted-foreground">{d.date.slice(5)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Cost Breakdown */}
        {costs && costs.costs.length > 0 && (
          <div className="glass-panel rounded-2xl overflow-hidden">
            <div
              className="flex items-center justify-between p-4 cursor-pointer select-none hover:bg-white/5"
              onClick={() => setExpandedCost(!expandedCost)}
            >
              <h2 className="text-sm font-semibold text-white flex items-center gap-2">
                <DollarSign className="w-4 h-4 text-green-400" /> Cost by Agent & Model
              </h2>
              {expandedCost ? <ChevronDown className="w-4 h-4 text-white/40" /> : <ChevronRight className="w-4 h-4 text-white/40" />}
            </div>
            {expandedCost && (
              <div className="border-t border-white/5 p-4 space-y-2">
                {costs.costs.map((c, i) => (
                  <div key={i} className="flex items-center justify-between bg-black/20 rounded-lg p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Bot className="w-4 h-4 text-primary" />
                      <span className="text-white font-medium">{c.agentName}</span>
                      <span className="text-[10px] font-mono text-white/40 bg-white/5 px-1.5 py-0.5 rounded">{c.model}</span>
                    </div>
                    <div className="flex items-center gap-4 text-xs">
                      <span className="text-white/50">{c.jobCount} jobs</span>
                      <span className="text-white/50">{c.tokensIn + c.tokensOut} tokens</span>
                      <span className="text-green-400 font-semibold">${(c.costCents / 100).toFixed(4)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Agent Performance */}
        <div className="glass-panel rounded-2xl p-5">
          <h2 className="text-sm font-semibold text-white mb-4 flex items-center gap-2">
            <Zap className="w-4 h-4 text-yellow-400" /> Agent Performance (7d)
          </h2>
          {perf.length === 0 ? (
            <p className="text-sm text-muted-foreground">No performance data yet. Send some messages to agents.</p>
          ) : (
            <div className="space-y-3">
              {perf.map((p) => {
                const successPct = Math.round(p.toolSuccessRate * 100);
                const avgSec = (p.avgDurationMs / 1000).toFixed(1);
                return (
                  <div key={p.agentId} className="bg-black/20 rounded-xl p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Bot className="w-4 h-4 text-primary" />
                        <span className="text-white font-semibold text-sm">{p.agentName}</span>
                        <span className="text-[10px] font-mono text-white/40">{p.totalJobs} jobs</span>
                      </div>
                      <span className={`text-xs font-bold ${successPct >= 90 ? "text-green-400" : successPct >= 70 ? "text-yellow-400" : "text-red-400"}`}>
                        {successPct}% success
                      </span>
                    </div>
                    <div className="grid grid-cols-3 gap-3">
                      <div className="text-center">
                        <Clock className="w-3.5 h-3.5 text-blue-400 mx-auto mb-1" />
                        <div className="text-xs text-white font-medium">{avgSec}s</div>
                        <div className="text-[10px] text-muted-foreground">Avg Speed</div>
                      </div>
                      <div className="text-center">
                        <MessageSquare className="w-3.5 h-3.5 text-purple-400 mx-auto mb-1" />
                        <div className="text-xs text-white font-medium">{Math.round(p.avgTokensOut)}</div>
                        <div className="text-[10px] text-muted-foreground">Avg Tokens</div>
                      </div>
                      <div className="text-center">
                        <ShieldAlert className="w-3.5 h-3.5 text-red-400 mx-auto mb-1" />
                        <div className="text-xs text-white font-medium">{Math.round(p.errorRate * 100)}%</div>
                        <div className="text-[10px] text-muted-foreground">Error Rate</div>
                      </div>
                    </div>
                    {/* Success bar */}
                    <div className="mt-3 h-1.5 bg-white/5 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${successPct >= 90 ? "bg-green-400" : successPct >= 70 ? "bg-yellow-400" : "bg-red-400"}`} style={{ width: `${successPct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
