import { db } from "@workspace/db";
import { activityLogTable, agentsTable, appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { execWithCreds } from "./sshManager";
import { emitActivity } from "./activityEmitter";
import { decrypt } from "./encryption";

export interface ToolResult {
  success: boolean;
  output: string;
  error?: string;
}

async function getSettings() {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  return settings;
}

async function getVpsCredentials() {
  const { vpsConfigTable } = await import("@workspace/db");
  const [vps] = await db.select().from(vpsConfigTable).limit(1);
  if (!vps || !vps.encryptedCredential) return null;

  const cred = decrypt(vps.encryptedCredential);
  return {
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
    const result = await execWithCreds(creds, command, 30000);
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
  const pathModule = require("path") as typeof import("path");
  const normalized = userPath.replace(/^\/+/, "");
  const resolved = pathModule.resolve(sandboxDir, normalized);
  const sandboxResolved = pathModule.resolve(sandboxDir);
  if (resolved !== sandboxResolved && !resolved.startsWith(sandboxResolved + pathModule.sep)) {
    return null;
  }
  return resolved;
}

export async function fileReadTool(
  agentId: number,
  agentName: string,
  filePath: string
): Promise<ToolResult> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const sandboxDir = path.resolve(process.cwd(), "agent-files", String(agentId));
  await fs.mkdir(sandboxDir, { recursive: true });

  const safePath = resolveSandboxPath(sandboxDir, filePath);
  if (!safePath) return { success: false, output: "", error: "Access denied: path outside sandbox" };

  await logActivity(agentId, agentName, "file_read", `Reading: ${filePath}`);

  try {
    const content = await fs.readFile(safePath, "utf8");
    return { success: true, output: content };
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
  const fs = await import("fs/promises");
  const path = await import("path");

  const sandboxDir = path.resolve(process.cwd(), "agent-files", String(agentId));
  await fs.mkdir(sandboxDir, { recursive: true });

  const safePath = resolveSandboxPath(sandboxDir, filePath);
  if (!safePath) return { success: false, output: "", error: "Access denied: path outside sandbox" };

  await logActivity(agentId, agentName, "file_write", `Writing: ${filePath}`);

  try {
    await fs.mkdir(path.dirname(safePath), { recursive: true });
    await fs.writeFile(safePath, content, "utf8");
    return { success: true, output: `Written ${content.length} chars to ${filePath}` };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, output: "", error };
  }
}

export async function fileListTool(agentId: number, agentName: string, dir = ""): Promise<ToolResult> {
  const fs = await import("fs/promises");
  const path = await import("path");

  const sandboxDir = path.resolve(process.cwd(), "agent-files", String(agentId));
  await fs.mkdir(sandboxDir, { recursive: true });

  const safeDir = dir ? resolveSandboxPath(sandboxDir, dir) : sandboxDir;
  if (!safeDir) return { success: false, output: "", error: "Access denied: path outside sandbox" };

  try {
    const entries = await fs.readdir(safeDir, { withFileTypes: true });
    const list = entries.map((e) => `${e.isDirectory() ? "[dir]" : "[file]"} ${e.name}`).join("\n");
    return { success: true, output: list || "(empty)" };
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
  const path = await import("path");
  const { spawn } = await import("child_process");
  const os = await import("os");

  const ext = language === "python" ? ".py" : ".mjs";
  const tmpFile = path.join(os.tmpdir(), `agent-${agentId}-${Date.now()}${ext}`);

  try {
    await fs.writeFile(tmpFile, code);

    const cmd = language === "python" ? "python3" : "node";
    
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      const proc = spawn(cmd, [tmpFile], { timeout: 10000 });

      proc.stdout.on("data", (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on("data", (d: Buffer) => { stderr += d.toString(); });
      proc.on("close", (code) => {
        fs.unlink(tmpFile).catch(() => {});
        resolve({
          success: code === 0,
          output: stdout + (stderr ? `\nSTDERR:\n${stderr}` : ""),
        });
      });
      proc.on("error", (err) => {
        resolve({ success: false, output: "", error: err.message });
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
