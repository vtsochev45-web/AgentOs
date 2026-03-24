import { useState, useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import type { VpsConfig, AppSettings } from "@workspace/api-client-react";
import { useGetSettings, useSaveSettings, useGetVpsConfig, useSaveVpsConfig } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiFetch } from "@/lib/api";
import {
  Settings as SettingsIcon, Server, Brain, Mail, Save, Search,
  Webhook, Key, Link2, RefreshCw, CheckCircle2, XCircle, BookOpen,
  Loader2, ChevronRight, AlertCircle, Zap,
} from "lucide-react";

type Tab = "openclaw" | "providers" | "vps" | "skills" | "notifications";

const TABS: { id: Tab; label: string; icon: React.ElementType }[] = [
  { id: "openclaw", label: "Openclaw", icon: Link2 },
  { id: "providers", label: "Providers", icon: Brain },
  { id: "vps", label: "VPS", icon: Server },
  { id: "skills", label: "Skills", icon: BookOpen },
  { id: "notifications", label: "Alerts", icon: Webhook },
];

const inputCls = "w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white placeholder:text-white/30 focus:outline-none focus:ring-2 focus:ring-primary/60 focus:border-transparent transition-all font-sans text-sm";
const labelCls = "block text-xs font-semibold text-white/60 uppercase tracking-widest mb-1.5";
const sectionCls = "glass-panel rounded-2xl overflow-hidden";
const headerCls = "p-4 border-b border-white/8 bg-white/3 flex items-center gap-2.5";

type ConnectionStatus = "idle" | "loading" | "ok" | "error";

function StatusBadge({ status, label }: { status: ConnectionStatus; label?: string }) {
  if (status === "idle") return null;
  if (status === "loading") return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <Loader2 className="w-3.5 h-3.5 animate-spin" /> Testing…
    </span>
  );
  if (status === "ok") return (
    <span className="inline-flex items-center gap-1.5 text-xs text-green-400 font-medium">
      <CheckCircle2 className="w-3.5 h-3.5" /> {label ?? "Connected"}
    </span>
  );
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-red-400 font-medium">
      <XCircle className="w-3.5 h-3.5" /> {label ?? "Failed"}
    </span>
  );
}

export default function Settings() {
  const [activeTab, setActiveTab] = useState<Tab>("openclaw");
  const { data: vpsConfig } = useGetVpsConfig();
  const { data: settings } = useGetSettings();

  return (
    <div className="max-w-4xl mx-auto h-full flex flex-col">
      <header className="mb-6 flex-shrink-0">
        <h1
          className="text-2xl font-bold text-white flex items-center gap-2.5"
          style={{ fontFamily: "'Clash Display', system-ui, sans-serif" }}
        >
          <SettingsIcon className="w-6 h-6 text-primary" />
          Config Hub
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">Manage providers, VPS, skills, and connections.</p>
      </header>

      {/* Tab Bar */}
      <div className="flex gap-1 mb-6 bg-white/3 p-1 rounded-xl border border-white/8 flex-shrink-0 overflow-x-auto">
        {TABS.map(tab => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium whitespace-nowrap transition-all flex-1 justify-center
                ${activeTab === tab.id
                  ? "bg-primary text-white shadow-sm"
                  : "text-muted-foreground hover:text-white hover:bg-white/5"
                }`}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              <span className="hidden sm:block">{tab.label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar pb-10 space-y-5">
        {activeTab === "openclaw" && (
          <OpenclawTab settings={settings as AppSettings | undefined} />
        )}
        {activeTab === "providers" && (
          <ProvidersTab settings={settings as AppSettings | undefined} />
        )}
        {activeTab === "vps" && (
          <VpsTab initialData={vpsConfig as VpsConfig | undefined} />
        )}
        {activeTab === "skills" && <SkillsTab />}
        {activeTab === "notifications" && (
          <NotificationsTab settings={settings as AppSettings | undefined} />
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Openclaw Instance Tab
───────────────────────────────────────────── */
const openclawSchema = z.object({
  openclawInstanceUrl: z.string().url("Must be a valid URL").or(z.literal("")),
  openclawApiKey: z.string().optional(),
});

function OpenclawTab({ settings }: { settings?: AppSettings }) {
  const mutation = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testStatus, setTestStatus] = useState<ConnectionStatus>("idle");
  const [testDetail, setTestDetail] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ agentsImported: number; conversationsImported: number } | null>(null);

  const form = useForm({
    resolver: zodResolver(openclawSchema),
    values: {
      openclawInstanceUrl: (settings as any)?.openclawInstanceUrl ?? "",
      openclawApiKey: "",
    },
  });

  const onSubmit = (data: z.infer<typeof openclawSchema>) => {
    mutation.mutate({ data: data as any }, {
      onSuccess: () => {
        toast({ title: "Openclaw Connection Saved" });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      },
      onError: err => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
    });
  };

  const handleTest = async () => {
    setTestStatus("loading");
    setTestDetail("");
    try {
      const res = await apiFetch("/api/openclaw/test", { method: "POST" });
      const data = await res.json();
      if (data.ok) {
        setTestStatus("ok");
        setTestDetail(`${data.latencyMs}ms`);
      } else {
        setTestStatus("error");
        setTestDetail(data.error ?? "Unreachable");
      }
    } catch (e) {
      setTestStatus("error");
      setTestDetail(String(e));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await apiFetch("/api/openclaw/sync", { method: "POST" });
      const data = await res.json();
      setSyncResult(data);
      toast({ title: "Sync Complete", description: `${data.agentsImported} agents, ${data.conversationsImported} conversations imported.` });
    } catch (e) {
      toast({ title: "Sync Failed", description: String(e), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  };

  const isConfigured = !!(settings as any)?.openclawInstanceUrl;

  return (
    <>
      <div className={sectionCls}>
        <div className={headerCls}>
          <Link2 className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-white">Openclaw Instance</h2>
          {isConfigured && (
            <span className="ml-auto text-[10px] font-mono text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">CONFIGURED</span>
          )}
        </div>
        <div className="p-5">
          <p className="text-sm text-muted-foreground mb-5">
            Connect to a self-hosted Openclaw instance running on your VPS or server. Once connected, this dashboard can sync agents, conversations, and config directly from that instance.
          </p>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <label className={labelCls}>Instance URL</label>
              <input {...form.register("openclawInstanceUrl")} className={inputCls} placeholder="http://your-vps-ip:3000" />
              {form.formState.errors.openclawInstanceUrl && (
                <p className="text-red-400 text-xs mt-1">{String(form.formState.errors.openclawInstanceUrl.message ?? "")}</p>
              )}
            </div>
            <div>
              <label className={labelCls}>
                API Key {isConfigured && <span className="normal-case font-normal text-muted-foreground">(blank = keep existing)</span>}
              </label>
              <input type="password" {...form.register("openclawApiKey")} className={inputCls} placeholder="Leave blank if no auth required" />
            </div>
            <div className="flex items-center gap-3 pt-2 flex-wrap">
              <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 disabled:opacity-60 transition-all">
                <Save className="w-4 h-4" /> {mutation.isPending ? "Saving…" : "Save"}
              </button>
              {isConfigured && (
                <button type="button" onClick={handleTest} disabled={testStatus === "loading"} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-5 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all disabled:opacity-60">
                  <Zap className="w-4 h-4" /> Test Connection
                </button>
              )}
              <StatusBadge status={testStatus} label={testStatus === "ok" ? `Connected · ${testDetail}` : testDetail || undefined} />
            </div>
          </form>
        </div>
      </div>

      {isConfigured && (
        <div className={sectionCls}>
          <div className={headerCls}>
            <RefreshCw className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold text-white">Sync from Instance</h2>
          </div>
          <div className="p-5">
            <p className="text-sm text-muted-foreground mb-4">
              Pull agents and conversations from your connected Openclaw instance into this dashboard. Existing records are not overwritten.
            </p>
            {syncResult && (
              <div className="mb-4 p-3 bg-green-400/10 border border-green-400/20 rounded-xl text-sm text-green-300">
                Imported {syncResult.agentsImported} agents · {syncResult.conversationsImported} conversations
              </div>
            )}
            <button onClick={handleSync} disabled={syncing} className="bg-primary/15 hover:bg-primary/25 border border-primary/30 text-white px-5 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all disabled:opacity-60">
              {syncing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
              {syncing ? "Syncing…" : "Sync Now"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/* ─────────────────────────────────────────────
   Providers Tab
───────────────────────────────────────────── */
const providersSchema = z.object({
  aiModel: z.string().optional(),
  openaiApiKey: z.string().optional(),
  anthropicApiKey: z.string().optional(),
  searchProvider: z.enum(["duckduckgo", "brave"]).optional(),
  braveApiKey: z.string().optional(),
});

function ProvidersTab({ settings }: { settings?: AppSettings }) {
  const mutation = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [openaiStatus, setOpenaiStatus] = useState<ConnectionStatus>("idle");
  const [anthropicStatus, setAnthropicStatus] = useState<ConnectionStatus>("idle");

  const form = useForm({
    resolver: zodResolver(providersSchema),
    values: {
      aiModel: (settings as any)?.aiModel ?? "gpt-4o",
      openaiApiKey: "",
      anthropicApiKey: "",
      searchProvider: ((settings as any)?.searchProvider as "duckduckgo" | "brave") ?? "duckduckgo",
      braveApiKey: "",
    },
  });

  const onSubmit = (data: z.infer<typeof providersSchema>) => {
    mutation.mutate({ data: data as any }, {
      onSuccess: () => {
        toast({ title: "Providers Saved" });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      },
      onError: err => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
    });
  };

  const testOpenAI = async () => {
    setOpenaiStatus("loading");
    try {
      const res = await apiFetch("/api/settings/test/openai", { method: "POST" });
      const data = await res.json();
      setOpenaiStatus(data.ok ? "ok" : "error");
    } catch { setOpenaiStatus("error"); }
  };

  const testAnthropic = async () => {
    setAnthropicStatus("loading");
    try {
      const res = await apiFetch("/api/settings/test/anthropic", { method: "POST" });
      const data = await res.json();
      setAnthropicStatus(data.ok ? "ok" : "error");
    } catch { setAnthropicStatus("error"); }
  };

  const AI_MODELS = [
    "gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-3.5-turbo",
    "claude-3-5-sonnet-20241022", "claude-3-5-haiku-20241022", "claude-3-opus-20240229",
    "gpt-5.2",
  ];

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
      {/* AI Model */}
      <div className={sectionCls}>
        <div className={headerCls}>
          <Brain className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-white">AI Model</h2>
        </div>
        <div className="p-5">
          <label className={labelCls}>Default Model</label>
          <select {...form.register("aiModel")} className={inputCls}>
            {AI_MODELS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <p className="text-xs text-muted-foreground mt-2">Used by all agents unless overridden per-agent.</p>
        </div>
      </div>

      {/* OpenAI */}
      <div className={sectionCls}>
        <div className={headerCls}>
          <Key className="w-4 h-4 text-green-400" />
          <h2 className="text-base font-bold text-white">OpenAI</h2>
          {(settings as any)?.openaiApiKeyConfigured && (
            <span className="ml-auto text-[10px] font-mono text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">KEY SET</span>
          )}
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={labelCls}>
              API Key {(settings as any)?.openaiApiKeyConfigured && <span className="normal-case font-normal text-muted-foreground">(blank = keep existing)</span>}
            </label>
            <input type="password" {...form.register("openaiApiKey")} className={inputCls} placeholder="sk-…" autoComplete="off" />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={testOpenAI} disabled={openaiStatus === "loading" || !(settings as any)?.openaiApiKeyConfigured} className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40">
              <Zap className="w-3 h-3" /> Test
            </button>
            <StatusBadge status={openaiStatus} />
          </div>
        </div>
      </div>

      {/* Anthropic */}
      <div className={sectionCls}>
        <div className={headerCls}>
          <Key className="w-4 h-4 text-orange-400" />
          <h2 className="text-base font-bold text-white">Anthropic</h2>
          {(settings as any)?.anthropicApiKeyConfigured && (
            <span className="ml-auto text-[10px] font-mono text-orange-400 bg-orange-400/10 px-2 py-0.5 rounded-full border border-orange-400/20">KEY SET</span>
          )}
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className={labelCls}>
              API Key {(settings as any)?.anthropicApiKeyConfigured && <span className="normal-case font-normal text-muted-foreground">(blank = keep existing)</span>}
            </label>
            <input type="password" {...form.register("anthropicApiKey")} className={inputCls} placeholder="sk-ant-…" autoComplete="off" />
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={testAnthropic} disabled={anthropicStatus === "loading" || !(settings as any)?.anthropicApiKeyConfigured} className="text-xs bg-white/5 hover:bg-white/10 border border-white/10 text-white px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all disabled:opacity-40">
              <Zap className="w-3 h-3" /> Test
            </button>
            <StatusBadge status={anthropicStatus} />
          </div>
        </div>
      </div>

      {/* Search */}
      <div className={sectionCls}>
        <div className={headerCls}>
          <Search className="w-4 h-4 text-primary" />
          <h2 className="text-base font-bold text-white">Web Search</h2>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className={labelCls}>Provider</label>
            <select {...form.register("searchProvider")} className={inputCls}>
              <option value="duckduckgo">DuckDuckGo (free, no key needed)</option>
              <option value="brave">Brave Search (API key required)</option>
            </select>
          </div>
          {form.watch("searchProvider") === "brave" && (
            <div>
              <label className={labelCls}>Brave API Key {(settings as any)?.braveApiKeyConfigured && <span className="normal-case font-normal text-muted-foreground">(blank = keep)</span>}</label>
              <input {...form.register("braveApiKey")} className={inputCls} placeholder="BSA…" />
            </div>
          )}
        </div>
      </div>

      <div className="flex justify-end">
        <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-white px-6 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-primary/20">
          <Save className="w-4 h-4" /> {mutation.isPending ? "Saving…" : "Save Providers"}
        </button>
      </div>
    </form>
  );
}

/* ─────────────────────────────────────────────
   VPS Tab
───────────────────────────────────────────── */
const vpsSchema = z.object({
  host: z.string().min(1, "Required"),
  username: z.string().min(1, "Required"),
  port: z.coerce.number().min(1),
  authType: z.enum(["password", "key"]),
  password: z.string().optional(),
  privateKey: z.string().optional(),
});

function VpsTab({ initialData }: { initialData?: VpsConfig }) {
  const mutation = useSaveVpsConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [testStatus, setTestStatus] = useState<ConnectionStatus>("idle");
  const [testDetail, setTestDetail] = useState("");

  const form = useForm({
    resolver: zodResolver(vpsSchema),
    values: {
      host: initialData?.host ?? "",
      username: initialData?.username ?? "root",
      port: initialData?.port ?? 22,
      authType: (initialData?.authType as "password" | "key") ?? "password",
      password: "",
      privateKey: "",
    },
  });

  const onSubmit = (data: z.infer<typeof vpsSchema>) => {
    mutation.mutate({ data: { ...data, label: "Primary VPS" } as any }, {
      onSuccess: () => {
        toast({ title: "VPS Config Saved" });
        queryClient.invalidateQueries({ queryKey: ["/api/vps/config"] });
      },
      onError: err => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
    });
  };

  const testConnection = async () => {
    setTestStatus("loading");
    setTestDetail("");
    try {
      const res = await apiFetch("/api/vps/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cmd: "echo OK" }),
      });
      if (res.ok) {
        setTestStatus("ok");
        setTestDetail("SSH handshake succeeded");
      } else {
        const d = await res.json().catch(() => ({}));
        setTestStatus("error");
        setTestDetail((d as any).error ?? `HTTP ${res.status}`);
      }
    } catch (e) {
      setTestStatus("error");
      setTestDetail(String(e));
    }
  };

  return (
    <div className={sectionCls}>
      <div className={headerCls}>
        <Server className="w-4 h-4 text-primary" />
        <h2 className="text-base font-bold text-white">VPS SSH Uplink</h2>
        {initialData?.hasCredentials && (
          <span className="ml-auto text-[10px] font-mono text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">CONFIGURED</span>
        )}
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="p-5 space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Hostname / IP</label>
            <input {...form.register("host")} className={inputCls} placeholder="203.0.113.1" />
            {form.formState.errors.host && <p className="text-red-400 text-xs mt-1">{form.formState.errors.host.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Username</label>
              <input {...form.register("username")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input type="number" {...form.register("port")} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>Auth Method</label>
            <select {...form.register("authType")} className={inputCls}>
              <option value="password">Password</option>
              <option value="key">Private Key</option>
            </select>
          </div>
          {form.watch("authType") === "password" ? (
            <div>
              <label className={labelCls}>
                Password {initialData?.hasCredentials && <span className="normal-case font-normal text-muted-foreground">(blank = keep)</span>}
              </label>
              <input type="password" autoComplete="current-password" {...form.register("password")} className={inputCls} />
            </div>
          ) : (
            <div className="sm:col-span-2">
              <label className={labelCls}>RSA Private Key</label>
              <textarea {...form.register("privateKey")} rows={5} className={`${inputCls} font-mono text-xs resize-none`} placeholder="-----BEGIN RSA PRIVATE KEY-----…" />
            </div>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap pt-1">
          <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-white px-5 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 disabled:opacity-60 transition-all">
            <Save className="w-4 h-4" /> {mutation.isPending ? "Saving…" : "Save Config"}
          </button>
          {initialData?.hasCredentials && (
            <button type="button" onClick={testConnection} disabled={testStatus === "loading"} className="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-5 py-2 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all disabled:opacity-60">
              <Zap className="w-4 h-4" /> Test SSH
            </button>
          )}
          <StatusBadge status={testStatus} label={testStatus === "ok" ? testDetail : testDetail || undefined} />
        </div>
      </form>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Skills Tab
───────────────────────────────────────────── */
type SkillEntry = { name: string; hasSkillMd: boolean; sizeBytes: number; updatedAt: string | null };

function SkillsTab() {
  const [skills, setSkills] = useState<SkillEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [loadingContent, setLoadingContent] = useState(false);
  const [saving, setSaving] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    setLoading(true);
    apiFetch("/api/skills")
      .then(r => r.json())
      .then((data: SkillEntry[]) => setSkills(data.filter(s => s.hasSkillMd)))
      .catch(() => toast({ title: "Failed to load skills", variant: "destructive" }))
      .finally(() => setLoading(false));
  }, []);

  const selectSkill = async (name: string) => {
    setSelected(name);
    setLoadingContent(true);
    try {
      const res = await apiFetch(`/api/skills/${name}`);
      const data = await res.json();
      setContent(data.content ?? "");
    } catch {
      toast({ title: "Failed to load skill", variant: "destructive" });
    } finally {
      setLoadingContent(false);
    }
  };

  const saveSkill = async () => {
    if (!selected) return;
    setSaving(true);
    try {
      const res = await apiFetch(`/api/skills/${selected}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        toast({ title: "Skill Saved", description: `${selected}/SKILL.md updated.` });
      } else {
        throw new Error("Save failed");
      }
    } catch {
      toast({ title: "Save Failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 min-h-[500px]">
      {/* Skill List */}
      <div className={`${sectionCls} md:w-56 flex-shrink-0`}>
        <div className={headerCls}>
          <BookOpen className="w-4 h-4 text-primary" />
          <h2 className="text-sm font-bold text-white">Skills</h2>
          {!loading && <span className="ml-auto text-xs text-muted-foreground">{skills.length}</span>}
        </div>
        <div className="overflow-y-auto max-h-[420px] custom-scrollbar">
          {loading ? (
            <div className="p-4 flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading…
            </div>
          ) : skills.length === 0 ? (
            <div className="p-4 text-sm text-muted-foreground flex items-center gap-2">
              <AlertCircle className="w-4 h-4" /> No skills found
            </div>
          ) : (
            skills.map(skill => (
              <button
                key={skill.name}
                onClick={() => selectSkill(skill.name)}
                className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between transition-colors
                  ${selected === skill.name ? "bg-primary/15 text-primary border-l-2 border-primary" : "text-muted-foreground hover:text-white hover:bg-white/5"}
                `}
              >
                <span className="truncate font-mono text-xs">{skill.name}</span>
                <ChevronRight className="w-3 h-3 flex-shrink-0 opacity-40" />
              </button>
            ))
          )}
        </div>
      </div>

      {/* Editor */}
      <div className={`${sectionCls} flex-1 flex flex-col min-h-[400px]`}>
        {!selected ? (
          <div className="flex-1 flex items-center justify-center text-muted-foreground text-sm">
            <div className="text-center">
              <BookOpen className="w-8 h-8 mx-auto mb-2 opacity-30" />
              <p>Select a skill to edit</p>
            </div>
          </div>
        ) : loadingContent ? (
          <div className="flex-1 flex items-center justify-center">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className={`${headerCls} flex-shrink-0`}>
              <BookOpen className="w-4 h-4 text-primary" />
              <span className="text-sm font-bold text-white font-mono">{selected}/SKILL.md</span>
              <button onClick={saveSkill} disabled={saving} className="ml-auto bg-primary hover:bg-primary/90 text-white px-4 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 disabled:opacity-60 transition-all">
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />}
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              className="flex-1 w-full bg-transparent text-white/90 font-mono text-xs p-4 resize-none focus:outline-none leading-relaxed custom-scrollbar"
              spellCheck={false}
            />
          </>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Notifications & Security Tab
───────────────────────────────────────────── */
const notifSchema = z.object({
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  webhookUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

function NotificationsTab({ settings }: { settings?: AppSettings }) {
  const mutation = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("openclaw_api_key") ?? "");
  const [keySaved, setKeySaved] = useState(false);

  const form = useForm({
    resolver: zodResolver(notifSchema),
    values: {
      smtpHost: (settings as any)?.smtpHost ?? "",
      smtpPort: (settings as any)?.smtpPort ?? 587,
      smtpUser: (settings as any)?.smtpUser ?? "",
      smtpPassword: "",
      webhookUrl: (settings as any)?.webhookUrl ?? "",
    },
  });

  const onSubmit = (data: z.infer<typeof notifSchema>) => {
    mutation.mutate({ data: data as any }, {
      onSuccess: () => {
        toast({ title: "Settings Saved" });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      },
      onError: err => toast({ title: "Save Failed", description: err.message, variant: "destructive" }),
    });
  };

  const saveApiKey = () => {
    if (apiKey.trim()) localStorage.setItem("openclaw_api_key", apiKey.trim());
    else localStorage.removeItem("openclaw_api_key");
    setKeySaved(true);
    toast({ title: "API Key Saved", description: "Stored in your browser." });
    setTimeout(() => setKeySaved(false), 2000);
  };

  return (
    <div className="space-y-5">
      {/* Dashboard API Key */}
      <div className={sectionCls}>
        <div className={headerCls}>
          <Key className="w-4 h-4 text-yellow-400" />
          <h2 className="text-base font-bold text-white">Dashboard API Key</h2>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-muted-foreground">
            If <code className="bg-black/40 px-1 rounded text-xs font-mono">OPENCLAW_API_KEY</code> is set on the server, enter it here so the dashboard authenticates automatically. Stored in your browser only.
          </p>
          <div className="flex gap-3 items-center">
            <input
              type="password"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              onKeyDown={e => e.key === "Enter" && saveApiKey()}
              className={`${inputCls} flex-1`}
              placeholder="sk-…"
              autoComplete="off"
            />
            <button onClick={saveApiKey} className="bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 border border-yellow-400/30 px-4 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 transition-all whitespace-nowrap">
              <Save className="w-4 h-4" /> {keySaved ? "Saved!" : "Save"}
            </button>
          </div>
        </div>
      </div>

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
        {/* SMTP */}
        <div className={sectionCls}>
          <div className={headerCls}>
            <Mail className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold text-white">Email / SMTP</h2>
            {(settings as any)?.smtpConfigured && (
              <span className="ml-auto text-[10px] font-mono text-green-400 bg-green-400/10 px-2 py-0.5 rounded-full border border-green-400/20">CONFIGURED</span>
            )}
          </div>
          <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>SMTP Host</label>
              <input {...form.register("smtpHost")} className={inputCls} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className={labelCls}>Port</label>
              <input type="number" {...form.register("smtpPort")} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Username</label>
              <input {...form.register("smtpUser")} className={inputCls} placeholder="you@gmail.com" />
            </div>
            <div>
              <label className={labelCls}>Password / App Password {(settings as any)?.smtpConfigured && <span className="normal-case font-normal text-muted-foreground">(blank = keep)</span>}</label>
              <input type="password" autoComplete="new-password" {...form.register("smtpPassword")} className={inputCls} />
            </div>
          </div>
          <p className="px-5 pb-4 text-xs text-muted-foreground">Used by agents with the Email tool to send messages on your behalf.</p>
        </div>

        {/* Webhook */}
        <div className={sectionCls}>
          <div className={headerCls}>
            <Webhook className="w-4 h-4 text-primary" />
            <h2 className="text-base font-bold text-white">Webhook Notifications</h2>
          </div>
          <div className="p-5">
            <label className={labelCls}>Webhook URL</label>
            <input {...form.register("webhookUrl")} className={inputCls} placeholder="https://hooks.slack.com/…" />
            {form.formState.errors.webhookUrl && (
              <p className="text-red-400 text-xs mt-1">{String(form.formState.errors.webhookUrl.message)}</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">Agents with the Webhook tool will POST JSON events to this URL.</p>
          </div>
        </div>

        <div className="flex justify-end">
          <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-white px-6 py-2.5 rounded-xl font-semibold text-sm flex items-center gap-2 disabled:opacity-60 transition-all shadow-lg shadow-primary/20">
            <Save className="w-4 h-4" /> {mutation.isPending ? "Saving…" : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
