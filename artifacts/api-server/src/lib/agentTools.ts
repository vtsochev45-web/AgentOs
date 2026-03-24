import path from "path";
import os from "os";
import { db } from "@workspace/db";
import { activityLogTable, agentsTable, agentMessagesTable, agentFilesTable, appSettingsTable, websiteConfigsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { exec as sshExec, sftpReadFileById, sftpWriteFileById } from "./sshManager";
import { emitActivity } from "./activityEmitter";
import { decrypt } from "./encryption";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

async function getSettings() {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  if (!settings) return settings;
  return {
    ...settings,
    smtpPassword: settings.smtpPassword ? (() => { try { return decrypt(settings.smtpPassword!); } catch { return null; } })() : null,
    braveApiKey: settings.braveApiKey ? (() => { try { return decrypt(settings.braveApiKey!); } catch { return null; } })() : null,
  };
}

async function getVpsCredentials() {
  const { vpsConfigTable } = await import("@workspace/db");
  const [vps] = await db.select().from(vpsConfigTable).limit(1);
  if (!vps || !vps.encryptedCredential) return null;

  const cred = decrypt(vps.encryptedCredential);
  return {
    id: vps.id,
    host: vps.host,
    port: vps.port,
    username: vps.username,
    authType: vps.authType as "password" | "key",
    ...(vps.authType === "password" ? { password: cred } : { privateKey: cred }),
  };
}

async function logActivity(
  agentId: number,
  agentName: string,
  actionType: string,
  detail: string
) {
  const [entry] = await db
    .insert(activityLogTable)
    .values({ agentId, agentName, actionType, detail })
    .returning();

  emitActivity({
    id: entry?.id,
    agentId,
    agentName,
    actionType,
    detail,
    timestamp: entry?.timestamp?.toISOString() ?? new Date().toISOString(),
  });
}

export async function webSearchTool(
  query: string,
  agentId: number,
  agentName: string
): Promise<ToolResult & { sources?: Array<{ title: string; url: string; snippet: string; favicon?: string }> }> {
  await logActivity(agentId, agentName, "web_search", `Searching: "${query}"`);

  try {
    const settings = await getSettings();
    
    if (settings?.searchProvider === "brave" && settings?.braveApiKey) {
      const res = await fetch(
        `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=5`,
        {
          headers: {
            "Accept": "application/json",
            "X-Subscription-Token": settings.braveApiKey,
          },
        }
      );
      const data = await res.json() as { web?: { results: Array<{ title: string; url: string; description: string }> } };
      const results = data?.web?.results ?? [];
      const sources = results.map((r) => ({
        title: r.title,
        url: r.url,
        snippet: r.description,
        favicon: `https://www.google.com/s2/favicons?domain=${new URL(r.url).hostname}&sz=32`,
      }));
      return { success: true, output: results.map((r) => `${r.title}: ${r.description}`).join("\n"), sources };
    }

    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`
    );
    const data = await res.json() as {
      AbstractText?: string;
      RelatedTopics?: Array<{ Text?: string; FirstURL?: string }>;
      AbstractURL?: string;
    };

    const results: Array<{ title: string; url: string; snippet: string; favicon?: string }> = [];

    if (data.AbstractText && data.AbstractURL) {
      results.push({
        title: query,
        url: data.AbstractURL,
        snippet: data.AbstractText,
        favicon: `https://www.google.com/s2/favicons?domain=${new URL(data.AbstractURL).hostname}&sz=32`,
      });
    }

    const topics = (data.RelatedTopics ?? []).slice(0, 4);
    for (const topic of topics) {
      if (topic.Text && topic.FirstURL) {
        results.push({
          title: topic.Text.split(" - ")[0] ?? topic.Text.substring(0, 60),
          url: topic.FirstURL,
          snippet: topic.Text,
          favicon: `https://www.google.com/s2/favicons?domain=${new URL(topic.FirstURL).hostname}&sz=32`,
        });
      }
    }

    const output = results.map((r) => `${r.title}: ${r.snippet}`).join("\n");
    return { success: true, output: output || "No results found", sources: results };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function vpsShellTool(
  command: string,
  agentId: number,
  agentName: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "vps_exec", `Running: ${command}`);

  const creds = await getVpsCredentials();
  if (!creds) {
    return { success: false, output: "", error: "VPS not configured" };
  }

  try {
    const result = await sshExec(creds.id, creds, command, 30000);
    return {
      success: result.exitCode === 0,
      output: result.stdout + result.stderr,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

function resolveSandboxPath(sandboxDir: string, userPath: string): string | null {
  const normalized = userPath.replace(/^\/+/, "");
  const resolved = path.resolve(sandboxDir, normalized);
  const sandboxResolved = path.resolve(sandboxDir);
  if (resolved !== sandboxResolved && !resolved.startsWith(sandboxResolved + path.sep)) {
    return null;
  }
  return resolved;
}

export async function fileReadTool(
  agentId: number,
  agentName: string,
  filePath: string
): Promise<ToolResult> {
  const normalizedPath = filePath.replace(/^\/+/, "").replace(/\.\.\//g, "");
  if (!normalizedPath) return { success: false, output: "", error: "Invalid file path" };

  await logActivity(agentId, agentName, "file_read", `Reading: ${normalizedPath}`);

  try {
    const [file] = await db
      .select()
      .from(agentFilesTable)
      .where(and(eq(agentFilesTable.agentId, agentId), eq(agentFilesTable.path, normalizedPath)))
      .limit(1);

    if (!file) return { success: false, output: "", error: `File not found: ${normalizedPath}` };
    return { success: true, output: file.content };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function fileWriteTool(
  agentId: number,
  agentName: string,
  filePath: string,
  content: string
): Promise<ToolResult> {
  const normalizedPath = filePath.replace(/^\/+/, "").replace(/\.\.\//g, "");
  if (!normalizedPath) return { success: false, output: "", error: "Invalid file path" };

  await logActivity(agentId, agentName, "file_write", `Writing: ${normalizedPath}`);

  try {
    await db
      .insert(agentFilesTable)
      .values({ agentId, path: normalizedPath, content, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: [agentFilesTable.agentId, agentFilesTable.path],
        set: { content, updatedAt: new Date() },
      });

    return { success: true, output: `Written ${content.length} chars to ${normalizedPath}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function fileListTool(agentId: number, agentName: string, _dir = ""): Promise<ToolResult> {
  try {
    const files = await db
      .select({ path: agentFilesTable.path, updatedAt: agentFilesTable.updatedAt })
      .from(agentFilesTable)
      .where(eq(agentFilesTable.agentId, agentId));

    if (files.length === 0) return { success: true, output: "(no files)" };
    const list = files.map((f) => `${f.path}  (updated: ${f.updatedAt.toISOString()})`).join("\n");
    return { success: true, output: list };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function codeExecTool(
  agentId: number,
  agentName: string,
  code: string,
  language: "node" | "python" = "node"
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "code_exec", `Executing ${language} code`);

  const fs = await import("fs/promises");
  const { spawn } = await import("child_process");

  const ext = language === "python" ? ".py" : ".mjs";
  const sandboxDir = path.join(os.tmpdir(), `agent-sandbox-${agentId}`);
  const tmpFile = path.join(sandboxDir, `run-${Date.now()}${ext}`);

  try {
    await fs.mkdir(sandboxDir, { recursive: true });
    await fs.writeFile(tmpFile, code);

    const TIMEOUT_MS = 8000;

    let cmd: string;
    let cmdArgs: string[];

    if (language === "python") {
      cmd = "python3";
      cmdArgs = ["-I", "-S", tmpFile];
    } else {
      cmd = "node";
      cmdArgs = ["--no-experimental-fetch", "--disallow-code-generation-from-strings", tmpFile];
    }

    return await new Promise<ToolResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let resolved = false;

      const proc = spawn(cmd, cmdArgs, {
        timeout: TIMEOUT_MS,
        env: {
          PATH: process.env.PATH,
          HOME: sandboxDir,
          TMPDIR: sandboxDir,
        },
        uid: process.getuid?.(),
        cwd: sandboxDir,
      });

      const timer = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          proc.kill("SIGKILL");
          resolve({ success: false, output: stdout, error: "Execution timed out after 8 seconds" });
        }
      }, TIMEOUT_MS + 500);

      proc.stdout.on("data", (d: Buffer) => {
        stdout += d.toString();
        if (stdout.length > 32768) { proc.kill("SIGKILL"); }
      });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (exitCode) => {
        clearTimeout(timer);
        fs.unlink(tmpFile).catch(() => {});
        if (!resolved) {
          resolved = true;
          const truncated = stdout.length > 16384 ? stdout.slice(0, 16384) + "\n[output truncated]" : stdout;
          resolve({
            success: exitCode === 0,
            output: truncated + (stderr ? `\nSTDERR:\n${stderr.slice(0, 2048)}` : ""),
          });
        }
      });
      proc.on("error", (err) => {
        clearTimeout(timer);
        if (!resolved) {
          resolved = true;
          resolve({ success: false, output: "", error: err.message });
        }
      });
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function sendEmailTool(
  agentId: number,
  agentName: string,
  to: string,
  subject: string,
  body: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "email_sent", `Sent email to ${to}: ${subject}`);

  const settings = await getSettings();
  if (!settings?.smtpHost || !settings?.smtpUser || !settings?.smtpPassword) {
    return { success: false, output: "", error: "SMTP not configured" };
  }

  try {
    const nodemailer = await import("nodemailer");
    const transport = nodemailer.createTransport({
      host: settings.smtpHost,
      port: settings.smtpPort ?? 587,
      secure: (settings.smtpPort ?? 587) === 465,
      auth: { user: settings.smtpUser, pass: settings.smtpPassword },
    });

    await transport.sendMail({ from: settings.smtpUser, to, subject, text: body });
    return { success: true, output: `Email sent to ${to}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function delegateToAgentTool(
  fromAgentId: number,
  fromAgentName: string,
  toAgentName: string,
  task: string
): Promise<ToolResult & { delegationMessageId?: number }> {
  await logActivity(fromAgentId, fromAgentName, "delegate", `Delegating to ${toAgentName}: ${task.substring(0, 80)}`);

  try {
    const [toAgent] = await db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.name, toAgentName))
      .limit(1);

    if (!toAgent) {
      return { success: false, output: "", error: `Agent "${toAgentName}" not found` };
    }

    const [msg] = await db
      .insert(agentMessagesTable)
      .values({ fromAgentId, toAgentId: toAgent.id, content: task })
      .returning();

    return {
      success: true,
      output: `Delegated to ${toAgent.name} (ID ${toAgent.id}). Message ID: ${msg?.id}. The agent will process this task autonomously.`,
      delegationMessageId: msg?.id,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function sendWebhookTool(
  agentId: number,
  agentName: string,
  payload: Record<string, unknown>
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "webhook", `Sending webhook notification`);

  try {
    const settings = await getSettings();
    if (!settings?.webhookUrl) {
      return { success: false, output: "", error: "No webhook URL configured in Settings" };
    }

    const res = await fetch(settings.webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agent: agentName,
        agentId,
        timestamp: new Date().toISOString(),
        ...payload,
      }),
    });

    if (!res.ok) {
      return { success: false, output: "", error: `Webhook responded with ${res.status}` };
    }

    return { success: true, output: `Webhook delivered to ${settings.webhookUrl} (${res.status})` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

/* ── Website Management Tools ──────────────────────────────────── */

async function getWebsiteConfig(agentId: number) {
  const [config] = await db
    .select()
    .from(websiteConfigsTable)
    .where(eq(websiteConfigsTable.agentId, agentId))
    .limit(1);
  return config;
}

export async function websiteReadFileTool(
  agentId: number,
  agentName: string,
  filePath: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_read", `Reading: ${filePath}`);

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory) return { success: false, output: "", error: "No website VPS directory configured" };

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  try {
    const content = await sftpReadFileById(creds.id, creds, filePath);
    return { success: true, output: content };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

export async function websiteWriteFileTool(
  agentId: number,
  agentName: string,
  filePath: string,
  content: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_write", `Writing: ${filePath}`);

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory) return { success: false, output: "", error: "No website VPS directory configured" };

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  try {
    await sftpWriteFileById(creds.id, creds, filePath, content);
    return { success: true, output: `Written ${content.length} chars to ${filePath}` };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

export async function websiteBuildTool(
  agentId: number,
  agentName: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_build", "Running build command");

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory || !config?.buildCommand) {
    return { success: false, output: "", error: "Website directory and build command must be configured" };
  }

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  try {
    const result = await sshExec(
      creds.id, creds,
      `cd "${config.vpsDirectory}" && ${config.buildCommand} 2>&1`,
      120000
    );
    const output = result.stdout + result.stderr;
    const success = result.exitCode === 0;
    await logActivity(agentId, agentName, "website_build", success ? "Build succeeded" : `Build failed (exit ${result.exitCode})`);
    return { success, output };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

export async function websiteDeployTool(
  agentId: number,
  agentName: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_deploy", "Running deploy command");

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory) {
    return { success: false, output: "", error: "Website directory must be configured" };
  }

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  const cmd = config.deployCommand
    ? `cd "${config.vpsDirectory}" && ${config.deployCommand} 2>&1`
    : config.buildCommand
    ? `cd "${config.vpsDirectory}" && ${config.buildCommand} 2>&1`
    : null;

  if (!cmd) return { success: false, output: "", error: "No deploy or build command configured" };

  try {
    const result = await sshExec(creds.id, creds, cmd, 120000);
    const output = result.stdout + result.stderr;
    const success = result.exitCode === 0;
    await logActivity(agentId, agentName, "website_deploy", success ? "Deploy succeeded" : `Deploy failed (exit ${result.exitCode})`);
    return { success, output };
  } catch (err) {
    return { success: false, output: "", error: String(err) };
  }
}

export async function websiteHealthCheckTool(
  agentId: number,
  agentName: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_health", "Checking site health");

  const config = await getWebsiteConfig(agentId);
  if (!config?.siteUrl) return { success: false, output: "", error: "No site URL configured" };

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const r = await fetch(config.siteUrl, { signal: controller.signal });
    clearTimeout(timer);
    const latencyMs = Date.now() - start;
    const output = `HTTP ${r.status} — ${r.ok ? "UP" : "DOWN"} — ${latencyMs}ms`;
    return { success: r.ok, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}
