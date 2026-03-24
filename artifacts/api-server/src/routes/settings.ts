import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { appSettingsTable, vpsConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/encryption";
import { exec, type SshCredentials } from "../lib/sshManager";
import { requireApiKey } from "../middlewares/requireApiKey";

const router: IRouter = Router();

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

router.get("/settings", requireApiKey, async (req, res): Promise<void> => {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  if (!settings) {
    res.json({
      aiModel: "gpt-5.2",
      openaiApiKeyConfigured: false,
      anthropicApiKeyConfigured: false,
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpConfigured: false,
      webhookUrl: null,
      searchProvider: "duckduckgo",
      braveApiKeyConfigured: false,
      openclawInstanceUrl: null,
      openclawApiKeyConfigured: false,
    });
    return;
  }

  res.json({
    aiModel: settings.aiModel,
    openaiApiKeyConfigured: !!settings.openaiApiKey,
    anthropicApiKeyConfigured: !!settings.anthropicApiKey,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpConfigured: !!(settings.smtpHost && settings.smtpUser && settings.smtpPassword),
    webhookUrl: settings.webhookUrl,
    searchProvider: settings.searchProvider,
    braveApiKeyConfigured: !!settings.braveApiKey,
    openclawInstanceUrl: settings.openclawInstanceUrl,
    openclawApiKeyConfigured: !!settings.openclawApiKey,
  });
});

router.put("/settings", requireApiKey, async (req, res): Promise<void> => {
  const {
    aiModel, openaiApiKey, anthropicApiKey,
    smtpHost, smtpPort, smtpUser, smtpPassword,
    webhookUrl, searchProvider, braveApiKey,
    openclawInstanceUrl, openclawApiKey,
  } = req.body as {
    aiModel?: string; openaiApiKey?: string; anthropicApiKey?: string;
    smtpHost?: string; smtpPort?: number; smtpUser?: string; smtpPassword?: string;
    webhookUrl?: string; searchProvider?: string; braveApiKey?: string;
    openclawInstanceUrl?: string; openclawApiKey?: string;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (aiModel !== undefined) updates.aiModel = aiModel;
  if (openaiApiKey !== undefined && openaiApiKey !== "") updates.openaiApiKey = encrypt(openaiApiKey);
  if (anthropicApiKey !== undefined && anthropicApiKey !== "") updates.anthropicApiKey = encrypt(anthropicApiKey);
  if (smtpHost !== undefined) updates.smtpHost = smtpHost;
  if (smtpPort !== undefined) updates.smtpPort = smtpPort;
  if (smtpUser !== undefined) updates.smtpUser = smtpUser;
  if (smtpPassword !== undefined && smtpPassword !== "") updates.smtpPassword = encrypt(smtpPassword);
  if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
  if (searchProvider !== undefined) updates.searchProvider = searchProvider;
  if (braveApiKey !== undefined && braveApiKey !== "") updates.braveApiKey = encrypt(braveApiKey);
  if (openclawInstanceUrl !== undefined) updates.openclawInstanceUrl = openclawInstanceUrl;
  if (openclawApiKey !== undefined && openclawApiKey !== "") updates.openclawApiKey = encrypt(openclawApiKey);

  const [existing] = await db.select().from(appSettingsTable).limit(1);
  let settings;
  if (existing) {
    [settings] = await db.update(appSettingsTable).set(updates).where(eq(appSettingsTable.id, existing.id)).returning();
  } else {
    [settings] = await db.insert(appSettingsTable).values(updates as Record<string, unknown>).returning();
  }

  res.json({
    aiModel: settings!.aiModel,
    openaiApiKeyConfigured: !!settings!.openaiApiKey,
    anthropicApiKeyConfigured: !!settings!.anthropicApiKey,
    smtpHost: settings!.smtpHost,
    smtpPort: settings!.smtpPort,
    smtpUser: settings!.smtpUser,
    smtpConfigured: !!(settings!.smtpHost && settings!.smtpUser && settings!.smtpPassword),
    webhookUrl: settings!.webhookUrl,
    searchProvider: settings!.searchProvider,
    braveApiKeyConfigured: !!settings!.braveApiKey,
    openclawInstanceUrl: settings!.openclawInstanceUrl,
    openclawApiKeyConfigured: !!settings!.openclawApiKey,
  });
});

router.post("/settings/test/:provider", requireApiKey, async (req, res): Promise<void> => {
  const { provider } = req.params;
  const [settings] = await db.select().from(appSettingsTable).limit(1);

  if (provider === "openai") {
    if (!settings?.openaiApiKey) { res.json({ ok: false, error: "No OpenAI key configured" }); return; }
    const key = safeDecrypt(settings.openaiApiKey);
    if (!key) { res.json({ ok: false, error: "Failed to decrypt key" }); return; }
    try {
      const r = await fetch("https://api.openai.com/v1/models", {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(8000),
      });
      res.json({ ok: r.ok, status: r.status });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
    return;
  }

  if (provider === "anthropic") {
    if (!settings?.anthropicApiKey) { res.json({ ok: false, error: "No Anthropic key configured" }); return; }
    const key = safeDecrypt(settings.anthropicApiKey);
    if (!key) { res.json({ ok: false, error: "Failed to decrypt key" }); return; }
    try {
      const r = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
        signal: AbortSignal.timeout(8000),
      });
      res.json({ ok: r.ok, status: r.status });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
    return;
  }

  if (provider === "brave") {
    if (!settings?.braveApiKey) { res.json({ ok: false, error: "No Brave Search key configured" }); return; }
    const key = safeDecrypt(settings.braveApiKey);
    if (!key) { res.json({ ok: false, error: "Failed to decrypt key" }); return; }
    try {
      const r = await fetch("https://api.search.brave.com/res/v1/web/search?q=test&count=1", {
        headers: { "Accept": "application/json", "X-Subscription-Token": key },
        signal: AbortSignal.timeout(8000),
      });
      res.json({ ok: r.ok, status: r.status });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
    return;
  }

  if (provider === "smtp") {
    if (!settings?.smtpHost || !settings?.smtpUser || !settings?.smtpPassword) {
      res.json({ ok: false, error: "SMTP not fully configured" });
      return;
    }
    const password = safeDecrypt(settings.smtpPassword);
    if (!password) { res.json({ ok: false, error: "Failed to decrypt SMTP password" }); return; }
    try {
      const net = await import("net");
      const port = settings.smtpPort ?? 587;
      await new Promise<void>((resolve, reject) => {
        const socket = net.createConnection({ host: settings.smtpHost!, port }, () => {
          socket.destroy();
          resolve();
        });
        socket.setTimeout(6000);
        socket.on("error", reject);
        socket.on("timeout", () => { socket.destroy(); reject(new Error("Connection timed out")); });
      });
      res.json({ ok: true, message: `Reached ${settings.smtpHost}:${port}` });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
    return;
  }

  if (provider === "webhook") {
    if (!settings?.webhookUrl) { res.json({ ok: false, error: "No webhook URL configured" }); return; }
    try {
      const r = await fetch(settings.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ test: true, source: "openclaw" }),
        signal: AbortSignal.timeout(8000),
      });
      res.json({ ok: r.ok || r.status < 500, status: r.status });
    } catch (e) {
      res.json({ ok: false, error: String(e) });
    }
    return;
  }

  if (provider === "vps") {
    const [vpsConfig] = await db.select().from(vpsConfigTable).limit(1);
    if (!vpsConfig?.encryptedCredential) { res.json({ ok: false, error: "VPS not configured" }); return; }
    const { decrypt: dec } = await import("../lib/encryption");
    const cred = dec(vpsConfig.encryptedCredential);
    const creds: SshCredentials = {
      host: vpsConfig.host,
      port: vpsConfig.port,
      username: vpsConfig.username,
      authType: vpsConfig.authType as "password" | "key",
      password: vpsConfig.authType === "password" ? cred : undefined,
      privateKey: vpsConfig.authType === "key" ? cred : undefined,
    };
    try {
      const result = await exec(vpsConfig.id, creds, "echo 'ok'", 10000);
      res.json({ ok: result.exitCode === 0, message: result.stdout.trim() === "ok" ? "Connected" : result.stdout });
    } catch (e) {
      res.json({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
    return;
  }

  res.status(400).json({ error: `Unknown provider: ${provider}` });
});

export { safeDecrypt };
export default router;
