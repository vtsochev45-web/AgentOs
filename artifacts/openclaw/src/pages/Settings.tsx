import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useState } from "react";
import type { VpsConfig, AppSettings } from "@workspace/api-client-react";
import { useGetSettings, useSaveSettings, useGetVpsConfig, useSaveVpsConfig } from "@workspace/api-client-react";
import { Settings as SettingsIcon, Server, Brain, Mail, Save, Search, Webhook, Key } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const vpsSchema = z.object({
  host: z.string().min(1, "Required"),
  username: z.string().min(1, "Required"),
  port: z.coerce.number().min(1),
  authType: z.enum(["password", "key"]),
  password: z.string().optional(),
  privateKey: z.string().optional(),
});

const globalSchema = z.object({
  aiModel: z.string().optional(),
  smtpHost: z.string().optional(),
  smtpPort: z.coerce.number().optional(),
  smtpUser: z.string().optional(),
  smtpPassword: z.string().optional(),
  searchProvider: z.enum(["duckduckgo", "brave"]).optional(),
  braveApiKey: z.string().optional(),
  webhookUrl: z.string().url("Must be a valid URL").optional().or(z.literal("")),
});

export default function Settings() {
  const { data: vpsConfig } = useGetVpsConfig();
  const { data: settings } = useGetSettings();

  return (
    <div className="max-w-4xl mx-auto h-full overflow-y-auto custom-scrollbar pb-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-primary" />
          System Configuration
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Configure core integrations, intelligence, and secure uplinks.</p>
      </header>

      <div className="space-y-8">
        <DashboardApiKeyForm />
        <VpsConfigForm initialData={vpsConfig as VpsConfig | undefined} />
        <GlobalConfigForm initialData={settings as AppSettings | undefined} />
      </div>
    </div>
  );
}

function DashboardApiKeyForm() {
  const { toast } = useToast();
  const [apiKey, setApiKey] = useState(() => localStorage.getItem("openclaw_api_key") ?? "");
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    if (apiKey.trim()) {
      localStorage.setItem("openclaw_api_key", apiKey.trim());
    } else {
      localStorage.removeItem("openclaw_api_key");
    }
    setSaved(true);
    toast({ title: "API Key Updated", description: "Your dashboard API key has been saved locally." });
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-white/10 bg-white/5 flex items-center gap-3">
        <Key className="w-5 h-5 text-yellow-400" />
        <h2 className="text-xl font-bold text-white">Dashboard API Key</h2>
      </div>
      <div className="p-6 space-y-4">
        <p className="text-sm text-muted-foreground">
          If <code className="bg-black/40 px-1 rounded text-xs">OPENCLAW_API_KEY</code> is set on the server, all API and terminal operations require this key. Enter it here so the dashboard can authenticate automatically. The key is stored only in your browser.
        </p>
        <div className="flex gap-3 items-center">
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-yellow-400/60 transition-all font-mono"
            placeholder="sk-..."
          />
          <button
            onClick={handleSave}
            className="bg-yellow-400/20 hover:bg-yellow-400/30 text-yellow-400 border border-yellow-400/30 px-5 py-2.5 rounded-xl font-semibold flex items-center gap-2 transition-all"
          >
            <Save className="w-4 h-4" /> {saved ? "Saved!" : "Save"}
          </button>
        </div>
        {!apiKey && (
          <p className="text-xs text-muted-foreground/60">No key set — all API calls are sent without authentication (only safe in dev mode).</p>
        )}
      </div>
    </div>
  );
}

function VpsConfigForm({ initialData }: { initialData?: VpsConfig }) {
  const mutation = useSaveVpsConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();

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
    mutation.mutate({ data: { ...data, label: "Primary VPS" } as Parameters<typeof mutation.mutate>[0]["data"] }, {
      onSuccess: () => {
        toast({ title: "VPS Configuration Saved", description: "SSH uplink credentials stored securely." });
        queryClient.invalidateQueries({ queryKey: ["/api/vps/config"] });
      },
      onError: (err) => {
        toast({ title: "Save Failed", description: err.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-white/10 bg-white/5 flex items-center gap-3">
        <Server className="w-5 h-5 text-primary" />
        <h2 className="text-xl font-bold text-white">VPS SSH Uplink</h2>
        {initialData?.hasCredentials && (
          <span className="ml-auto text-xs font-mono text-green-400 bg-green-400/10 px-2 py-1 rounded-full border border-green-400/20">CONFIGURED</span>
        )}
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Hostname / IP</label>
            <input {...form.register("host")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent transition-all" placeholder="e.g. 192.168.1.1" />
            {form.formState.errors.host && <p className="text-red-400 text-xs">{form.formState.errors.host.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Username</label>
              <input {...form.register("username")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Port</label>
              <input type="number" {...form.register("port")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Authentication Method</label>
            <select {...form.register("authType")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all">
              <option value="password">Password</option>
              <option value="key">Private Key</option>
            </select>
          </div>

          {form.watch("authType") === "password" ? (
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">
                Password {initialData?.hasCredentials && <span className="text-muted-foreground">(blank = keep existing)</span>}
              </label>
              <input type="password" autoComplete="current-password" {...form.register("password")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>
          ) : (
            <div className="space-y-2 md:col-span-2">
              <label className="text-sm font-medium text-white/80">RSA Private Key</label>
              <textarea {...form.register("privateKey")} rows={4} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary font-mono text-xs resize-none transition-all" placeholder="-----BEGIN RSA PRIVATE KEY-----..." />
            </div>
          )}
        </div>
        <div className="flex justify-end pt-4">
          <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-60 transition-all">
            <Save className="w-4 h-4" /> {mutation.isPending ? "Saving..." : "Save Configuration"}
          </button>
        </div>
      </form>
    </div>
  );
}

function GlobalConfigForm({ initialData }: { initialData?: AppSettings }) {
  const mutation = useSaveSettings();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm({
    resolver: zodResolver(globalSchema),
    values: {
      aiModel: initialData?.aiModel ?? "gpt-4o",
      smtpHost: initialData?.smtpHost ?? "",
      smtpPort: initialData?.smtpPort ?? 587,
      smtpUser: initialData?.smtpUser ?? "",
      smtpPassword: "",
      searchProvider: (initialData?.searchProvider as "duckduckgo" | "brave" | undefined) ?? "duckduckgo",
      braveApiKey: "",
      webhookUrl: initialData?.webhookUrl ?? "",
    },
  });

  const onSubmit = (data: z.infer<typeof globalSchema>) => {
    mutation.mutate({ data: data as Parameters<typeof mutation.mutate>[0]["data"] }, {
      onSuccess: () => {
        toast({ title: "Settings Saved", description: "Global configuration updated." });
        queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      },
      onError: (err) => {
        toast({ title: "Save Failed", description: err.message, variant: "destructive" });
      },
    });
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-white/10 bg-white/5 flex items-center gap-3">
        <Brain className="w-5 h-5 text-accent" />
        <h2 className="text-xl font-bold text-white">Intelligence & Integrations</h2>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-8">
        <div>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Brain className="w-4 h-4 text-accent" /> AI Model
          </h3>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Model Name</label>
            <input {...form.register("aiModel")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="gpt-4o" />
            <p className="text-xs text-muted-foreground">OpenAI model identifier used by all agents (e.g. gpt-4o, gpt-4-turbo, gpt-3.5-turbo).</p>
          </div>
        </div>

        <div>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Search className="w-4 h-4 text-primary" /> Web Search Provider
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Provider</label>
              <select {...form.register("searchProvider")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all">
                <option value="duckduckgo">DuckDuckGo (free)</option>
                <option value="brave">Brave Search (API key required)</option>
              </select>
            </div>
            {form.watch("searchProvider") === "brave" && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Brave API Key</label>
                <input {...form.register("braveApiKey")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="BSA..." />
              </div>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" /> Email / SMTP
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">SMTP Host</label>
              <input {...form.register("smtpHost")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="smtp.gmail.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">SMTP Port</label>
              <input type="number" {...form.register("smtpPort")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">SMTP Username</label>
              <input {...form.register("smtpUser")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="you@gmail.com" />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">SMTP Password / App Password</label>
              <input type="password" autoComplete="new-password" {...form.register("smtpPassword")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-2">Used by agents with the "Messaging" tool to send emails on your behalf.</p>
        </div>

        <div>
          <h3 className="text-base font-semibold text-white mb-4 flex items-center gap-2">
            <Webhook className="w-4 h-4 text-primary" /> Webhook Notifications
          </h3>
          <div className="space-y-2">
            <label className="text-sm font-medium text-white/80">Webhook URL</label>
            <input {...form.register("webhookUrl")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:outline-none focus:ring-2 focus:ring-primary transition-all" placeholder="https://hooks.slack.com/..." />
            {form.formState.errors.webhookUrl && <p className="text-red-400 text-xs">{String(form.formState.errors.webhookUrl.message)}</p>}
            <p className="text-xs text-muted-foreground">Agents with the "Send Webhook" tool will POST JSON payloads to this URL.</p>
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 flex items-center gap-2 disabled:opacity-60 transition-all">
            <Save className="w-4 h-4" /> {mutation.isPending ? "Saving..." : "Save Settings"}
          </button>
        </div>
      </form>
    </div>
  );
}
