import { WebSocket, WebSocketServer } from "ws";
import type { IncomingMessage } from "http";
import type { Server } from "http";
import { db } from "@workspace/db";
import { vpsConfigTable } from "@workspace/db";
import { decrypt } from "./encryption";
import { logger } from "./logger";
import { Client, type ConnectConfig } from "ssh2";

async function getVpsCreds() {
  const [config] = await db.select().from(vpsConfigTable).limit(1);
  if (!config || !config.encryptedCredential) return null;
  const cred = decrypt(config.encryptedCredential);
  return {
    host: config.host,
    port: config.port,
    username: config.username,
    authType: config.authType as "password" | "key",
    ...(config.authType === "password" ? { password: cred } : { privateKey: cred }),
  };
}

export function setupWebSocketTerminal(server: Server): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request: IncomingMessage, socket, head) => {
    const url = request.url ?? "";
    if (url.startsWith("/api/vps/terminal")) {
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit("connection", ws, request);
      });
    } else {
      socket.destroy();
    }
  });

  wss.on("connection", async (ws: WebSocket) => {
    logger.info("WebSocket terminal connection attempt");

    const creds = await getVpsCreds();
    if (!creds) {
      ws.send("VPS not configured. Go to Settings to set up SSH credentials.\r\n");
      ws.close();
      return;
    }

    const sshClient = new Client();

    const config: ConnectConfig = {
      host: creds.host,
      port: creds.port,
      username: creds.username,
      readyTimeout: 15000,
    };

    if (creds.authType === "password" && creds.password) {
      config.password = creds.password;
    } else if (creds.authType === "key" && creds.privateKey) {
      config.privateKey = creds.privateKey;
    }

    sshClient.on("ready", () => {
      logger.info("SSH terminal session ready");

      sshClient.shell({ term: "xterm-256color" }, (err, stream) => {
        if (err) {
          ws.send(`\r\nError starting shell: ${err.message}\r\n`);
          ws.close();
          sshClient.end();
          return;
        }

        ws.on("message", (data: Buffer | string) => {
          const str = typeof data === "string" ? data : data.toString("utf8");
          try {
            const parsed = JSON.parse(str);
            if (parsed.type === "resize") {
              stream.setWindow(parsed.rows ?? 24, parsed.cols ?? 80, 0, 0);
              return;
            }
          } catch {}
          stream.write(str);
        });

        stream.on("data", (chunk: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk.toString("utf8"));
          }
        });

        stream.stderr.on("data", (chunk: Buffer) => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(chunk.toString("utf8"));
          }
        });

        stream.on("close", () => {
          logger.info("SSH shell stream closed");
          ws.close();
          sshClient.end();
        });

        ws.on("close", () => {
          stream.end();
          sshClient.end();
        });
      });
    });

    sshClient.on("error", (err) => {
      logger.error({ err }, "SSH connection error");
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(`\r\nSSH Error: ${err.message}\r\n`);
      }
      ws.close();
    });

    sshClient.connect(config);
  });

  logger.info("WebSocket terminal server attached");
}
