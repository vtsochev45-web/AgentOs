import { Router, type IRouter } from "express";
import { requireApiKey } from "../middlewares/requireApiKey";
import { db } from "@workspace/db";
import { websiteConfigsTable, vpsConfigTable, activityLogTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import {
  exec as sshExec,
  sftpReadFileById,
  sftpWriteFileById,
  sftpListDirById,
  type SshCredentials,
} from "../lib/sshManager";
import { decrypt } from "../lib/encryption";
import { persistAndEmitActivity } from "../lib/activityEmitter";

const router: IRouter = Router();

async function getVpsCreds(): Promise<(SshCredentials & { id: number }) | null> {
  const [config] = await db.select().from(vpsConfigTable).limit(1);
  if (!config || !config.encryptedCredential) return null;
  const cred = decrypt(config.encryptedCredential);
  return {
    id: config.id,
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType as "password" | "key",
    password: config.authType === "password" ? cred : undefined,
    privateKey: config.authType === "key" ? cred : undefined,
  };
}

function parseAgentId(raw: string | string[]): number {
  return parseInt(Array.isArray(raw) ? raw[0]! : raw, 10);
}

/* ── GET website config ─────────────────────────────────────────── */
router.get("/agents/:id/website", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);
  if (!config) { res.status(404).json({ error: "No website config" }); return; }
  res.json(config);
});

/* ── PUT website config ─────────────────────────────────────────── */
router.put("/agents/:id/website", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const { type, repoUrl, branch, vpsDirectory, siteUrl, buildCommand, deployCommand } = req.body as {
    type?: string; repoUrl?: string; branch?: string; vpsDirectory?: string;
    siteUrl?: string; buildCommand?: string; deployCommand?: string;
  };

  const [existing] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  const values = {
    agentId,
    type: type ?? "vps-path",
    repoUrl: repoUrl ?? null,
    branch: branch ?? "main",
    vpsDirectory: vpsDirectory ?? null,
    siteUrl: siteUrl ?? null,
    buildCommand: buildCommand ?? null,
    deployCommand: deployCommand ?? null,
    updatedAt: new Date(),
  };

  let config;
  if (existing) {
    [config] = await db
      .update(websiteConfigsTable)
      .set(values)
      .where(eq(websiteConfigsTable.id, existing.id))
      .returning();
  } else {
    [config] = await db.insert(websiteConfigsTable).values(values).returning();
  }

  res.json(config);
});

/* ── GET site health check ──────────────────────────────────────── */
router.get("/agents/:id/website/health", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.siteUrl) { res.json({ ok: false, error: "No site URL configured" }); return; }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(config.siteUrl, { signal: controller.signal, method: "GET" });
    clearTimeout(timeout);
    const latencyMs = Date.now() - start;
    const text = await r.text().catch(() => "");
    const titleMatch = text.match(/<title[^>]*>([^<]*)<\/title>/i);
    res.json({
      ok: r.ok,
      status: r.status,
      latencyMs,
      title: titleMatch?.[1]?.trim() ?? null,
      url: config.siteUrl,
    });
  } catch (err) {
    const latencyMs = Date.now() - start;
    const msg = err instanceof Error ? err.message : String(err);
    res.json({ ok: false, status: 0, latencyMs, error: msg.includes("abort") ? "Timed out" : msg });
  }
});

/* ── GET git info (branch, last commit) ────────────────────────── */
router.get("/agents/:id/website/git", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory) { res.status(400).json({ error: "No VPS directory configured" }); return; }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  try {
    const dir = config.vpsDirectory;
    const [branchRes, logRes, statusRes] = await Promise.all([
      sshExec(creds.id, creds, `cd "${dir}" && git rev-parse --abbrev-ref HEAD 2>/dev/null || echo ""`, 8000),
      sshExec(creds.id, creds, `cd "${dir}" && git log -1 --format="%H|%s|%an|%ar" 2>/dev/null || echo ""`, 8000),
      sshExec(creds.id, creds, `cd "${dir}" && git status --short 2>/dev/null | wc -l || echo "0"`, 8000),
    ]);

    const branch = branchRes.stdout.trim();
    const logParts = logRes.stdout.trim().split("|");
    const uncommittedFiles = parseInt(statusRes.stdout.trim(), 10) || 0;

    res.json({
      branch: branch || null,
      commit: logParts[0]?.substring(0, 8) ?? null,
      commitMessage: logParts[1] ?? null,
      commitAuthor: logParts[2] ?? null,
      commitAge: logParts[3] ?? null,
      uncommittedFiles,
    });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── GET file list in website dir ──────────────────────────────── */
router.get("/agents/:id/website/files", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory) { res.status(400).json({ error: "No VPS directory configured" }); return; }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  const dirPath = (req.query.path as string) || config.vpsDirectory;

  const PATH_RE = /^[\w./@~-][\w./@~/ -]*$/;
  if (!PATH_RE.test(dirPath)) { res.status(400).json({ error: "Invalid path" }); return; }

  try {
    const files = await sftpListDirById(creds.id, creds, dirPath);
    res.json(files);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── GET file content ───────────────────────────────────────────── */
router.get("/agents/:id/website/files/content", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory) { res.status(400).json({ error: "No VPS directory configured" }); return; }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  const filePath = req.query.path as string;
  if (!filePath) { res.status(400).json({ error: "path is required" }); return; }

  const PATH_RE = /^[\w./@~-][\w./@~/ -]*$/;
  if (!PATH_RE.test(filePath)) { res.status(400).json({ error: "Invalid path" }); return; }

  try {
    const content = await sftpReadFileById(creds.id, creds, filePath);
    res.json({ path: filePath, content });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── PUT file content ───────────────────────────────────────────── */
router.put("/agents/:id/website/files/content", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory) { res.status(400).json({ error: "No VPS directory configured" }); return; }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  const { path: filePath, content } = req.body as { path: string; content: string };
  if (!filePath || content === undefined) { res.status(400).json({ error: "path and content are required" }); return; }

  const PATH_RE = /^[\w./@~-][\w./@~/ -]*$/;
  if (!PATH_RE.test(filePath)) { res.status(400).json({ error: "Invalid path" }); return; }

  try {
    await sftpWriteFileById(creds.id, creds, filePath, content);
    await persistAndEmitActivity({
      timestamp: new Date().toISOString(),
      agentId,
      agentName: `Agent #${agentId}`,
      actionType: "website_edit",
      detail: `Edited ${filePath}`,
    });
    res.json({ ok: true, path: filePath });
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

/* ── POST build (SSE streaming) ─────────────────────────────────── */
router.post("/agents/:id/website/build", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory || !config?.buildCommand) {
    res.status(400).json({ error: "VPS directory and build command are required" });
    return;
  }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type: string, data: string) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  send("log", `$ cd ${config.vpsDirectory} && ${config.buildCommand}`);

  await persistAndEmitActivity({
    timestamp: new Date().toISOString(),
    agentId,
    agentName: `Agent #${agentId}`,
    actionType: "website_build",
    detail: `Running: ${config.buildCommand}`,
  });

  try {
    const result = await sshExec(
      creds.id,
      creds,
      `cd "${config.vpsDirectory}" && ${config.buildCommand} 2>&1`,
      120000
    );

    const lines = (result.stdout + result.stderr).split("\n");
    for (const line of lines) {
      send("log", line);
    }

    const success = result.exitCode === 0;
    send("done", success ? "Build succeeded" : `Build failed (exit ${result.exitCode})`);

    await persistAndEmitActivity({
      timestamp: new Date().toISOString(),
      agentId,
      agentName: `Agent #${agentId}`,
      actionType: "website_build",
      detail: success ? "Build succeeded" : `Build failed (exit ${result.exitCode})`,
    });
  } catch (err) {
    send("error", String(err));
  }

  res.end();
});

/* ── POST deploy ────────────────────────────────────────────────── */
router.post("/agents/:id/website/deploy", requireApiKey, async (req, res): Promise<void> => {
  const agentId = parseAgentId(req.params.id!);
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);

  if (!config?.vpsDirectory) {
    res.status(400).json({ error: "VPS directory is required" });
    return;
  }

  const creds = await getVpsCreds();
  if (!creds) { res.status(503).json({ error: "VPS not configured" }); return; }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const send = (type: string, data: string) => {
    if (!res.writableEnded) res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
  };

  await persistAndEmitActivity({
    timestamp: new Date().toISOString(),
    agentId,
    agentName: `Agent #${agentId}`,
    actionType: "website_deploy",
    detail: `Starting deploy from ${config.vpsDirectory}`,
  });

  try {
    // Run build first if configured
    if (config.buildCommand) {
      send("log", `$ cd ${config.vpsDirectory} && ${config.buildCommand}`);
      const buildResult = await sshExec(
        creds.id, creds,
        `cd "${config.vpsDirectory}" && ${config.buildCommand} 2>&1`,
        120000
      );
      for (const line of (buildResult.stdout + buildResult.stderr).split("\n")) {
        send("log", line);
      }
      if (buildResult.exitCode !== 0) {
        send("error", `Build failed (exit ${buildResult.exitCode})`);
        res.end();
        return;
      }
      send("log", "✓ Build succeeded");
    }

    // Run deploy command if configured
    if (config.deployCommand) {
      send("log", `$ cd ${config.vpsDirectory} && ${config.deployCommand}`);
      const deployResult = await sshExec(
        creds.id, creds,
        `cd "${config.vpsDirectory}" && ${config.deployCommand} 2>&1`,
        60000
      );
      for (const line of (deployResult.stdout + deployResult.stderr).split("\n")) {
        send("log", line);
      }
      if (deployResult.exitCode !== 0) {
        send("error", `Deploy failed (exit ${deployResult.exitCode})`);
        res.end();
        return;
      }
      send("log", "✓ Deploy succeeded");
    } else if (config.type === "git") {
      // git push if no deploy command
      send("log", `$ cd ${config.vpsDirectory} && git push`);
      const pushResult = await sshExec(
        creds.id, creds,
        `cd "${config.vpsDirectory}" && git push 2>&1`,
        30000
      );
      for (const line of (pushResult.stdout + pushResult.stderr).split("\n")) {
        send("log", line);
      }
    }

    // Health check after deploy
    if (config.siteUrl) {
      send("log", `\nChecking ${config.siteUrl}…`);
      try {
        const start = Date.now();
        const r = await fetch(config.siteUrl, { signal: AbortSignal.timeout(10000) });
        const ms = Date.now() - start;
        send("log", `✓ Site is ${r.ok ? "UP" : "responding"} — HTTP ${r.status} (${ms}ms)`);
      } catch {
        send("log", "⚠ Could not reach site URL after deploy");
      }
    }

    send("done", "Deploy complete");

    await persistAndEmitActivity({
      timestamp: new Date().toISOString(),
      agentId,
      agentName: `Agent #${agentId}`,
      actionType: "website_deploy",
      detail: "Deploy completed successfully",
    });
  } catch (err) {
    send("error", String(err));
  }

  res.end();
});

export default router;
