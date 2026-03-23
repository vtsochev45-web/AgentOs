import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { vpsConfigTable } from "@workspace/db";
import { encrypt, decrypt } from "../lib/encryption";
import { exec, execStreaming, sftpReadFileById, sftpWriteFileById, sftpListDirById, sftpUnlinkById, sftpReadFileBuffer, type SshCredentials } from "../lib/sshManager";
import { eq } from "drizzle-orm";
import { emitActivity } from "../lib/activityEmitter";

const router: IRouter = Router();

const SERVICE_NAME_RE = /^[a-zA-Z0-9_@.-]+$/;

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

router.get("/vps/config", async (req, res): Promise<void> => {
  const [config] = await db.select().from(vpsConfigTable).limit(1);
  if (!config) { res.status(404).json({ error: "Not configured" }); return; }
  res.json({
    id: config.id,
    label: config.label,
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType,
    hasCredentials: !!config.encryptedCredential,
    createdAt: config.createdAt,
  });
});

router.put("/vps/config", async (req, res): Promise<void> => {
  const { label, host, port, username, authType, password, privateKey } = req.body as {
    label: string; host: string; port: number; username: string;
    authType: "password" | "key"; password?: string; privateKey?: string;
  };

  const credential = authType === "password" ? password : privateKey;
  const encryptedCredential = credential ? encrypt(credential) : undefined;

  const [existing] = await db.select().from(vpsConfigTable).limit(1);
  let config;
  if (existing) {
    const updates: Record<string, unknown> = { label, host, port, username, authType, updatedAt: new Date() };
    if (encryptedCredential) updates.encryptedCredential = encryptedCredential;
    [config] = await db.update(vpsConfigTable).set(updates).where(eq(vpsConfigTable.id, existing.id)).returning();
  } else {
    [config] = await db.insert(vpsConfigTable).values({ label, host, port, username, authType, encryptedCredential }).returning();
  }

  res.json({
    id: config!.id,
    label: config!.label,
    host: config!.host,
    port: config!.port,
    username: config!.username,
    authType: config!.authType,
    hasCredentials: !!config!.encryptedCredential,
    createdAt: config!.createdAt,
  });
});

router.post("/vps/test", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.json({ success: false, message: "VPS not configured" }); return; }

  try {
    const result = await exec(creds.id, creds, "echo 'ok'", 10000);
    res.json({ success: result.exitCode === 0, message: result.stdout.trim() === "ok" ? "Connected successfully" : result.stdout });
  } catch (err) {
    res.json({ success: false, message: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/vps/stats", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  try {
    const { stdout } = await exec(creds.id, creds,
      `echo "CPU:$(top -bn1 | grep 'Cpu(s)' | awk '{print $2}' | tr -d '%us,')" && ` +
      `echo "MEM:$(free -m | awk 'NR==2{print $3":"$2}')" && ` +
      `echo "DISK:$(df -BG / | awk 'NR==2{print $3":"$2}' | tr -d 'G')" && ` +
      `echo "UPTIME:$(uptime -p)" && ` +
      `echo "LOAD:$(uptime | awk -F'load average:' '{print $2}' | xargs)"`,
      10000
    );

    const lines = stdout.split("\n");
    const get = (prefix: string) => lines.find((l) => l.startsWith(prefix))?.split(":").slice(1).join(":") ?? "0";

    const cpuRaw = get("CPU");
    const memParts = get("MEM").split(":");
    const diskParts = get("DISK").split(":");

    res.json({
      cpuPercent: parseFloat(cpuRaw) || 0,
      memUsedMb: parseInt(memParts[0] ?? "0", 10),
      memTotalMb: parseInt(memParts[1] ?? "0", 10),
      diskUsedGb: parseInt(diskParts[0] ?? "0", 10),
      diskTotalGb: parseInt(diskParts[1] ?? "0", 10),
      uptime: get("UPTIME") || "unknown",
      loadAvg: get("LOAD") || "0 0 0",
    });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/vps/processes", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  try {
    const { stdout } = await exec(creds.id, creds, "ps aux --sort=-%cpu | head -30 | tail -n +2", 10000);
    const processes = stdout.trim().split("\n").map((line) => {
      const parts = line.trim().split(/\s+/);
      return {
        pid: parseInt(parts[1] ?? "0", 10),
        user: parts[0] ?? "",
        cpu: parts[2] ?? "0",
        mem: parts[3] ?? "0",
        command: parts.slice(10).join(" ") || parts[10] || "",
      };
    }).filter((p) => p.pid > 0);
    res.json(processes);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/processes/:pid/kill", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const pid = parseInt(Array.isArray(req.params.pid) ? req.params.pid[0]! : req.params.pid, 10);

  try {
    const { stdout, stderr, exitCode } = await exec(creds.id, creds, `kill -9 ${pid} 2>&1 && echo "killed"`, 10000);
    res.json({ success: exitCode === 0, stdout: stdout + stderr, stderr: "" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/vps/services", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  try {
    const { stdout: systemdOut } = await exec(creds.id, creds,
      "systemctl list-units --type=service --state=loaded --no-pager --no-legend 2>/dev/null | head -20 || echo ''",
      10000
    );
    const { stdout: pm2Out } = await exec(creds.id, creds,
      "pm2 jlist 2>/dev/null || echo '[]'",
      10000
    );

    const services = [];

    const systemdLines = systemdOut.trim().split("\n").filter(Boolean);
    for (const line of systemdLines) {
      const parts = line.trim().split(/\s+/);
      const name = (parts[0] ?? "").replace(".service", "");
      const status = parts[3] ?? "unknown";
      if (name) {
        services.push({ name, status, type: "systemd" as const });
      }
    }

    try {
      const pm2Apps = JSON.parse(pm2Out) as Array<{ name: string; pm2_env?: { status?: string } }>;
      for (const app of pm2Apps) {
        services.push({ name: app.name, status: app.pm2_env?.status ?? "unknown", type: "pm2" as const });
      }
    } catch {}

    res.json(services);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/services/:name/:action", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const name = Array.isArray(req.params.name) ? req.params.name[0]! : req.params.name;
  const action = Array.isArray(req.params.action) ? req.params.action[0]! : req.params.action;

  if (!["start", "stop", "restart", "status"].includes(action)) {
    res.status(400).json({ error: "Invalid action" });
    return;
  }

  if (!SERVICE_NAME_RE.test(name)) {
    res.status(400).json({ error: "Invalid service name" });
    return;
  }

  try {
    const { stdout, stderr, exitCode } = await exec(creds.id, creds,
      `systemctl ${action} ${name}.service 2>&1 || pm2 ${action} ${name} 2>&1`,
      15000
    );
    emitActivity({ actionType: "vps_service", detail: `${action} ${name}`, timestamp: new Date().toISOString() });
    res.json({ success: exitCode === 0, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/vps/files", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const path = String(req.query.path ?? "/");

  try {
    const entries = await sftpListDirById(creds.id, creds, path);
    res.json(entries);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/vps/files/read", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const path = String(req.query.path ?? "");
  if (!path) { res.status(400).json({ error: "path required" }); return; }

  try {
    const content = await sftpReadFileById(creds.id, creds, path);
    res.json({ path, content, encoding: "utf8" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/files/write", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const { path, content } = req.body as { path: string; content: string };
  if (!path) { res.status(400).json({ error: "path required" }); return; }

  try {
    await sftpWriteFileById(creds.id, creds, path, content);
    emitActivity({ actionType: "file_write", detail: `Wrote: ${path}`, timestamp: new Date().toISOString() });
    res.json({ success: true, stdout: `Written to ${path}`, stderr: "" });
  } catch (err) {
    res.json({ success: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
  }
});

router.delete("/vps/files/delete", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const filePath = String(req.query.path ?? "");
  if (!filePath) { res.status(400).json({ error: "path required" }); return; }

  try {
    await sftpUnlinkById(creds.id, creds, filePath);
    emitActivity({ actionType: "file_delete", detail: `Deleted: ${filePath}`, timestamp: new Date().toISOString() });
    res.json({ success: true, stdout: `Deleted ${filePath}`, stderr: "" });
  } catch (err) {
    res.json({ success: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/files/upload", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const { path: filePath, content } = req.body as { path: string; content: string };
  if (!filePath || content === undefined) { res.status(400).json({ error: "path and content required" }); return; }

  try {
    await sftpWriteFileById(creds.id, creds, filePath, content);
    emitActivity({ actionType: "file_write", detail: `Uploaded: ${filePath}`, timestamp: new Date().toISOString() });
    res.json({ success: true, stdout: `Uploaded to ${filePath}`, stderr: "" });
  } catch (err) {
    res.json({ success: false, stdout: "", stderr: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/processes/restart", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const { name } = req.body as { name?: string };
  if (!name) { res.status(400).json({ error: "name required" }); return; }

  if (!SERVICE_NAME_RE.test(name)) {
    res.status(400).json({ error: "Invalid process name" });
    return;
  }

  try {
    const { stdout, stderr, exitCode } = await exec(creds.id, creds,
      `systemctl restart ${name}.service 2>&1 || pm2 restart ${name} 2>&1`,
      15000
    );
    emitActivity({ actionType: "vps_service", detail: `restart ${name}`, timestamp: new Date().toISOString() });
    res.json({ success: exitCode === 0, stdout, stderr });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

router.post("/vps/exec", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const { command, timeout } = req.body as { command: string; timeout?: number };
  if (!command) { res.status(400).json({ error: "command required" }); return; }

  try {
    const result = await exec(creds.id, creds, command, timeout ?? 30000);
    emitActivity({ actionType: "vps_exec", detail: `Ran: ${command.substring(0, 80)}`, timestamp: new Date().toISOString() });
    res.json({ success: result.exitCode === 0, stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode });
  } catch (err) {
    res.json({ success: false, stdout: "", stderr: err instanceof Error ? err.message : String(err), exitCode: null });
  }
});

router.get("/vps/logs", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const logPath = String(req.query.path ?? "/var/log/syslog");
  const lines = parseInt(String(req.query.lines ?? "50"), 10);

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  let stopStream: (() => void) | null = null;

  const cleanup = () => {
    if (stopStream) {
      stopStream();
      stopStream = null;
    }
  };

  req.on("close", cleanup);

  try {
    const command = `tail -n ${lines} -f "${logPath}" 2>&1`;
    stopStream = await execStreaming(creds as SshCredentials, command, (chunk) => {
      const logLines = chunk.split("\n");
      for (const line of logLines) {
        if (line.trim() && !res.writableEnded) {
          res.write(`data: ${JSON.stringify({ line })}\n\n`);
        }
      }
    });
  } catch (err) {
    if (!res.writableEnded) {
      res.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
      res.end();
    }
  }
});

router.get("/vps/files/download", async (req, res): Promise<void> => {
  const creds = await getVpsCreds();
  if (!creds) { res.status(404).json({ error: "VPS not configured" }); return; }

  const filePath = String(req.query.path ?? "");
  if (!filePath) { res.status(400).json({ error: "path required" }); return; }

  try {
    const buffer = await sftpReadFileBuffer(creds.id, creds, filePath);
    const filename = filePath.split("/").pop() ?? "download";
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(buffer);
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
