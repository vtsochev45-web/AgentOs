import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useGetSettings, useSaveSettings, useGetVpsConfig, useSaveVpsConfig } from "@workspace/api-client-react";
import { Settings as SettingsIcon, Server, Shield, Brain, Mail, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";

const vpsSchema = z.object({
  host: z.string().min(1, "Required"),
  username: z.string().min(1, "Required"),
  port: z.coerce.number().min(1),
  authType: z.enum(["password", "key"]),
  password: z.string().optional(),
  privateKey: z.string().optional()
});

export default function Settings() {
  const { data: vpsConfig } = useGetVpsConfig();
  const { data: settings } = useGetSettings();
  
  return (
    <div className="max-w-4xl mx-auto h-full pb-10">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-white tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-8 h-8 text-primary" />
          System Configuration
        </h1>
        <p className="text-muted-foreground mt-2 text-sm">Configure core integrations, intelligence, and secure uplinks.</p>
      </header>

      <div className="space-y-8">
         <VpsConfigForm initialData={vpsConfig} />
         <GlobalConfigForm initialData={settings} />
      </div>
    </div>
  );
}

function VpsConfigForm({ initialData }: { initialData?: any }) {
  const mutation = useSaveVpsConfig();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const form = useForm({
    resolver: zodResolver(vpsSchema),
    values: {
      host: initialData?.host || "",
      username: initialData?.username || "root",
      port: initialData?.port || 22,
      authType: initialData?.authType || "password",
      password: "",
      privateKey: ""
    }
  });

  const onSubmit = (data: any) => {
    mutation.mutate({ data: { ...data, label: "Primary VPS" } }, {
      onSuccess: () => {
        toast({ title: "VPS Configuration Saved", description: "SSH uplink credentials stored securely." });
        queryClient.invalidateQueries({ queryKey: ["/api/vps/config"] });
      }
    });
  };

  return (
    <div className="glass-panel rounded-2xl overflow-hidden">
      <div className="p-5 border-b border-white/10 bg-white/5 flex items-center gap-3">
         <Server className="w-5 h-5 text-primary" />
         <h2 className="text-xl font-bold text-white">VPS SSH Uplink</h2>
      </div>
      <form onSubmit={form.handleSubmit(onSubmit)} className="p-6 space-y-6">
         <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Hostname / IP</label>
              <input {...form.register("host")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary" placeholder="e.g. 192.168.1.1" />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Username</label>
                <input {...form.register("username")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary" />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium text-white/80">Port</label>
                <input type="number" {...form.register("port")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary" />
              </div>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-white/80">Authentication Method</label>
              <select {...form.register("authType")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary">
                 <option value="password">Password</option>
                 <option value="key">Private Key</option>
              </select>
            </div>
            
            {form.watch("authType") === "password" ? (
               <div className="space-y-2">
                 <label className="text-sm font-medium text-white/80">Password {initialData?.hasCredentials && '(Leave blank to keep existing)'}</label>
                 <input type="password" {...form.register("password")} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary" />
               </div>
            ) : (
               <div className="space-y-2 md:col-span-2">
                 <label className="text-sm font-medium text-white/80">RSA Private Key</label>
                 <textarea {...form.register("privateKey")} rows={4} className="w-full bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white focus:ring-2 focus:ring-primary font-mono text-xs" placeholder="-----BEGIN RSA PRIVATE KEY-----..." />
               </div>
            )}
         </div>
         <div className="flex justify-end pt-4">
            <button type="submit" disabled={mutation.isPending} className="bg-primary hover:bg-primary/90 text-primary-foreground px-6 py-2.5 rounded-xl font-semibold shadow-lg shadow-primary/20 flex items-center gap-2">
               <Save className="w-4 h-4" /> {mutation.isPending ? 'Saving...' : 'Save Configuration'}
            </button>
         </div>
      </form>
    </div>
  );
}

function GlobalConfigForm({ initialData }: { initialData?: any }) {
  // Simplified for completeness
  return (
    <div className="glass-panel rounded-2xl overflow-hidden opacity-50 pointer-events-none">
       <div className="p-5 border-b border-white/10 bg-white/5 flex items-center gap-3">
         <Brain className="w-5 h-5 text-accent" />
         <h2 className="text-xl font-bold text-white">Global Intelligence (Coming Soon)</h2>
       </div>
       <div className="p-6">
         <p className="text-muted-foreground">AI Provider and Model settings are automatically managed by Replit AI Integrations in this version.</p>
       </div>
    </div>
  );
}
