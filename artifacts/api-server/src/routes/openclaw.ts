import { Router, type IRouter } from "express";
import { requireApiKey } from "../middlewares/requireApiKey";
import { db } from "@workspace/db";
import { appSettingsTable, agentsTable } from "@workspace/db";
import { decrypt } from "../lib/encryption";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

function safeDecrypt(val: string | null | undefined): string | null {
  if (!val) return null;
  try { return decrypt(val); } catch { return null; }
}

export async function getOpenclawConfig(): Promise<{ url: string; apiKey: string | null } | null> {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  if (!settings?.openclawInstanceUrl) return null;
  return {
    url: settings.openclawInstanceUrl.replace(/\/$/, ""),
    apiKey: safeDecrypt(settings.openclawApiKey),
  };
}

export function openclawHeaders(apiKey: string | null): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) h["Authorization"] = `Bearer ${apiKey}`;
  return h;
}

router.post("/openclaw/test", requireApiKey, async (req, res): Promise<void> => {
  const config = await getOpenclawConfig();
  if (!config) {
    res.json({ ok: false, error: "No Openclaw instance URL configured" });
    return;
  }

  const start = Date.now();
  try {
    const headers = openclawHeaders(config.apiKey);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    let response: Response | null = null;
    let lastError: string | null = null;

    for (const endpoint of ["/health", "/api/health", "/"]) {
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

  const headers = openclawHeaders(config.apiKey);
  let agentsImported = 0;
  const errors: string[] = [];

  try {
    // Use /api/chat/agents which returns proper agent IDs and names
    const agentsRes = await fetch(`${config.url}/api/chat/agents`, { headers });
    if (agentsRes.ok) {
      const remoteAgents = await agentsRes.json() as Array<{
        id: string; name: string; description?: string; model?: string;
      }>;

      for (const agent of remoteAgents) {
        try {
          // Check if agent with this openclawAgentId already exists
          const [existing] = await db.select().from(agentsTable)
            .where(eq(agentsTable.openclawAgentId, agent.id)).limit(1);

          if (existing) {
            // Update persona/name
            await db.update(agentsTable).set({
              name: agent.name,
              persona: agent.description ?? existing.persona,
            }).where(eq(agentsTable.id, existing.id));
          } else {
            await db.insert(agentsTable).values({
              name: agent.name,
              persona: agent.description ?? `OpenClaw ${agent.name} agent`,
              toolsEnabled: [],
              status: "idle",
              openclawAgentId: agent.id,
            });
          }
          agentsImported++;
        } catch {
          errors.push(`Agent "${agent.name}" skipped`);
        }
      }
    } else {
      errors.push(`Chat agents fetch failed: ${agentsRes.status}`);
    }
  } catch (e) {
    errors.push(`Agents: ${String(e)}`);
  }

  res.json({ ok: true, agentsImported, errors });
});

export default router;
