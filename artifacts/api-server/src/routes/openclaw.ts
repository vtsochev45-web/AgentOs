import { Router, type IRouter } from "express";
import { requireApiKey } from "../middlewares/requireApiKey";
import { db } from "@workspace/db";
import { appSettingsTable, agentsTable, conversations } from "@workspace/db";
import { decrypt } from "../lib/encryption";

const router: IRouter = Router();

function safeDecrypt(val: string | null | undefined): string | null {
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

async function getOpenclawConfig(): Promise<{ url: string; apiKey: string | null } | null> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  if (!settings?.openclawInstanceUrl) return null;
  return {
    url: settings.openclawInstanceUrl.replace(/\/$/, ""),
    apiKey: safeDecrypt(settings.openclawApiKey),
  };
}

router.post("/openclaw/test", requireApiKey, async (req, res): Promise<void> => {
  const config = await getOpenclawConfig();
  if (!config) {
    res.json({ ok: false, error: "No Openclaw instance URL configured" });
    return;
  }

  const start = Date.now();
  try {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (config.apiKey) headers["x-api-key"] = config.apiKey;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response: Response | null = null;
    let lastError: string | null = null;

    for (const endpoint of ["/api/health", "/api/ping", "/health", "/"]) {
      try {
        response = await fetch(`${config.url}${endpoint}`, {
          method: "GET",
          headers,
          signal: controller.signal,
        });
        if (response.ok || response.status < 500) break;
      } catch (e) {
        lastError = String(e);
      }
    }
    clearTimeout(timeout);

    const latencyMs = Date.now() - start;
    if (response && response.status < 500) {
      res.json({ ok: true, latencyMs, status: response.status, url: config.url });
    } else {
      res.json({ ok: false, latencyMs, error: lastError ?? "Unreachable", url: config.url });
    }
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, latencyMs, error: msg.includes("abort") ? "Connection timed out" : msg });
  }
});

router.post("/openclaw/sync", requireApiKey, async (req, res): Promise<void> => {
  const config = await getOpenclawConfig();
  if (!config) {
    res.status(400).json({ error: "No Openclaw instance configured" });
    return;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (config.apiKey) headers["x-api-key"] = config.apiKey;

  let agentsImported = 0;
  let conversationsImported = 0;
  const errors: string[] = [];

  try {
    const agentsRes = await fetch(`${config.url}/api/agents`, { headers });
    if (agentsRes.ok) {
      const remoteAgents = await agentsRes.json() as Array<{
        name: string; persona?: string; status?: string; toolsEnabled?: string[];
      }>;
      for (const agent of remoteAgents) {
        try {
          await db.insert(agentsTable).values({
            name: agent.name,
            persona: agent.persona ?? "A synced Openclaw agent",
            toolsEnabled: agent.toolsEnabled ?? [],
            status: (agent.status as "idle" | "thinking" | "searching" | "writing" | "delegating" | "executing") ?? "idle",
          }).onConflictDoNothing();
          agentsImported++;
        } catch {
          errors.push(`Agent "${agent.name}" skipped`);
        }
      }
    } else {
      errors.push(`Agents fetch failed: ${agentsRes.status}`);
    }
  } catch (e) {
    errors.push(`Agents: ${String(e)}`);
  }

  try {
    const convsRes = await fetch(`${config.url}/api/conversations`, { headers });
    if (convsRes.ok) {
      const remoteConvs = await convsRes.json() as Array<{ title?: string }>;
      for (const conv of remoteConvs) {
        try {
          await db.insert(conversations).values({
            title: conv.title ?? "Imported conversation",
          }).onConflictDoNothing();
          conversationsImported++;
        } catch {
          errors.push(`Conversation skipped`);
        }
      }
    } else {
      errors.push(`Conversations fetch failed: ${convsRes.status}`);
    }
  } catch (e) {
    errors.push(`Conversations: ${String(e)}`);
  }

  res.json({ ok: true, agentsImported, conversationsImported, errors });
});

export default router;
