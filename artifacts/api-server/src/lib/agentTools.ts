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

function isVpsPathSafe(vpsDirectory: string, filePath: string): boolean {
  if (!vpsDirectory || !filePath) return false;
  if (filePath.includes("..") || filePath.includes("//")) return false;
  const dir = vpsDirectory.endsWith("/") ? vpsDirectory : vpsDirectory + "/";
  return filePath === vpsDirectory || filePath.startsWith(dir);
}

/**
 * For git-type sites, ensure the repo is cloned on the VPS before SFTP ops.
 * Returns an error string if clone failed, or null if already present or cloned ok.
 */
async function ensureGitRepoPresent(
  config: { type: string; repoUrl?: string | null; branch: string; vpsDirectory: string },
  creds: { id: number } & import("./sshManager").SshCredentials
): Promise<string | null> {
  if (config.type !== "git" || !config.repoUrl) return null;
  const dir = config.vpsDirectory;
  const check = await sshExec(creds.id, creds, `test -d "${dir}/.git" && echo yes || echo no`, 10000);
  if (check.stdout.trim() === "yes") return null; // already present
  const clone = await sshExec(
    creds.id, creds,
    `git clone "${config.repoUrl}" -b "${config.branch || "main"}" "${dir}" 2>&1`,
    120000
  );
  if (clone.exitCode !== 0) {
    return `git clone failed (exit ${clone.exitCode}): ${clone.stdout + clone.stderr}`;
  }
  return null;
}

export async function websiteReadFileTool(
  agentId: number,
  agentName: string,
  filePath: string
): Promise<ToolResult> {
  await logActivity(agentId, agentName, "website_read", `Reading: ${filePath}`);

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory) return { success: false, output: "", error: "No website VPS directory configured" };

  if (!isVpsPathSafe(config.vpsDirectory, filePath)) {
    return { success: false, output: "", error: "Path is outside the configured website directory" };
  }

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  // For git-type sites: clone if repo isn't already present on VPS
  const cloneErr = await ensureGitRepoPresent(
    { type: config.type, repoUrl: config.repoUrl, branch: config.branch, vpsDirectory: config.vpsDirectory! },
    creds
  );
  if (cloneErr) return { success: false, output: "", error: cloneErr };

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

  if (!isVpsPathSafe(config.vpsDirectory, filePath)) {
    return { success: false, output: "", error: "Path is outside the configured website directory" };
  }

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  // For git-type sites: clone if repo isn't already present on VPS
  const cloneErrW = await ensureGitRepoPresent(
    { type: config.type, repoUrl: config.repoUrl, branch: config.branch, vpsDirectory: config.vpsDirectory! },
    creds
  );
  if (cloneErrW) return { success: false, output: "", error: cloneErrW };

  try {
    // Read before-state for diff summary
    let before = "";
    try { before = await sftpReadFileById(creds.id, creds, filePath); } catch { /* new file */ }

    await sftpWriteFileById(creds.id, creds, filePath, content);

    const changed = before !== content;
    const summary = changed
      ? `Written ${content.length} chars to ${filePath} (was ${before.length} chars — ${changed ? "changed" : "no change"})`
      : `Written ${filePath} — content unchanged`;
    return { success: true, output: summary };
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
  await logActivity(agentId, agentName, "website_deploy", "Running deploy");

  const config = await getWebsiteConfig(agentId);
  if (!config?.vpsDirectory) {
    return { success: false, output: "", error: "Website directory must be configured" };
  }

  const creds = await getVpsCredentials();
  if (!creds) return { success: false, output: "", error: "VPS not configured" };

  const dir = config.vpsDirectory;
  const lines: string[] = [];

  try {
    // For git-type sites: clone if missing, commit local edits, push, or pull
    if (config.type === "git" && config.repoUrl) {
      const branch = config.branch || "main";

      const checkGit = await sshExec(creds.id, creds, `test -d "${dir}/.git" && echo yes || echo no`, 10000);
      if (checkGit.stdout.trim() !== "yes") {
        // Clone the repo
        const clone = await sshExec(
          creds.id, creds,
          `git clone "${config.repoUrl}" -b "${branch}" "${dir}" 2>&1`,
          120000
        );
        lines.push(`git clone: exit=${clone.exitCode}`);
        lines.push(clone.stdout + clone.stderr);
        if (clone.exitCode !== 0) {
          await logActivity(agentId, agentName, "website_deploy", "Deploy failed: git clone error");
          return { success: false, output: lines.join("\n"), error: "git clone failed" };
        }
      } else {
        // Commit any local changes made by agent
        const status = await sshExec(creds.id, creds, `cd "${dir}" && git status --porcelain 2>&1`, 10000);
        if (status.stdout.trim()) {
          const commit = await sshExec(
            creds.id, creds,
            `cd "${dir}" && git add -A && git commit -m "Agent deploy: $(date -u +%Y-%m-%dT%H:%M:%SZ)" 2>&1`,
            30000
          );
          lines.push(`git commit: exit=${commit.exitCode}\n${commit.stdout + commit.stderr}`);
          if (commit.exitCode !== 0) {
            await logActivity(agentId, agentName, "website_deploy", "Deploy failed: git commit error");
            return { success: false, output: lines.join("\n"), error: "git commit failed" };
          }
          // Push committed changes
          const push = await sshExec(
            creds.id, creds,
            `cd "${dir}" && git push origin "${branch}" 2>&1`,
            60000
          );
          lines.push(`git push: exit=${push.exitCode}\n${push.stdout + push.stderr}`);
        } else {
          // No local changes — pull from remote
          const pull = await sshExec(
            creds.id, creds,
            `cd "${dir}" && git pull origin "${branch}" 2>&1`,
            60000
          );
          lines.push(`git pull: exit=${pull.exitCode}\n${pull.stdout + pull.stderr}`);
          if (pull.exitCode !== 0) {
            await logActivity(agentId, agentName, "website_deploy", "Deploy failed: git pull error");
            return { success: false, output: lines.join("\n"), error: "git pull failed" };
          }
        }
      }
    }

    // Run build command if configured
    if (config.buildCommand) {
      const build = await sshExec(
        creds.id, creds,
        `cd "${dir}" && ${config.buildCommand} 2>&1`,
        120000
      );
      lines.push(`build (exit=${build.exitCode}):\n${build.stdout + build.stderr}`);
      if (build.exitCode !== 0) {
        await logActivity(agentId, agentName, "website_deploy", "Deploy failed: build error");
        return { success: false, output: lines.join("\n"), error: "Build failed" };
      }
    }

    // Run deploy command if configured
    if (config.deployCommand) {
      const deploy = await sshExec(
        creds.id, creds,
        `cd "${dir}" && ${config.deployCommand} 2>&1`,
        60000
      );
      lines.push(`deploy (exit=${deploy.exitCode}):\n${deploy.stdout + deploy.stderr}`);
      if (deploy.exitCode !== 0) {
        await logActivity(agentId, agentName, "website_deploy", "Deploy failed: deploy command error");
        return { success: false, output: lines.join("\n"), error: "Deploy command failed" };
      }
    }

    await logActivity(agentId, agentName, "website_deploy", "Deploy succeeded");

    // Run health check after deploy if siteUrl is configured
    if (config.siteUrl) {
      const healthResult = await websiteHealthCheckTool(agentId, agentName);
      lines.push(`\nPost-deploy health check:\n${healthResult.output || healthResult.error || ""}`);
    }

    return { success: true, output: lines.join("\n") || "Deploy complete" };
  } catch (err) {
    return { success: false, output: lines.join("\n"), error: String(err) };
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

    // Parse page title from HTML response
    let title: string | null = null;
    try {
      const text = await r.text();
      const m = text.match(/<title[^>]*>([^<]*)<\/title>/i);
      title = m?.[1]?.trim() ?? null;
    } catch { /* ignore parse errors */ }

    const status = r.status;
    const up = r.ok;
    const output = `HTTP ${status} — ${up ? "UP" : "DOWN"} — ${latencyMs}ms${title ? ` — "${title}"` : ""}`;
    return { success: up, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: `UNREACHABLE — ${error}`, error };
  }
}
