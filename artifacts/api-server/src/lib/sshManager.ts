import { Client, type ConnectConfig } from "ssh2";
import { logger } from "./logger";

export interface SshSession {
  client: Client;
  connectedAt: Date;
}

const sessions = new Map<number, SshSession>();

export interface SshCredentials {
  host: string;
  port: number;
  username: string;
  authType: "password" | "key";
  password?: string;
  privateKey?: string;
}

async function connect(id: number, creds: SshCredentials): Promise<Client> {
  const existing = sessions.get(id);
  if (existing) {
    return existing.client;
  }

  return new Promise((resolve, reject) => {
    const client = new Client();

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

    client
      .on("ready", () => {
        sessions.set(id, { client, connectedAt: new Date() });
        logger.info({ vpsConfigId: id }, "SSH session established");
        resolve(client);
      })
      .on("error", (err) => {
        sessions.delete(id);
        reject(err);
      })
      .on("close", () => {
        sessions.delete(id);
        logger.info({ vpsConfigId: id }, "SSH session closed");
      })
      .connect(config);
  });
}

export async function exec(
  creds: SshCredentials,
  command: string,
  timeout = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const client = await connect(-1, creds);
  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";

    client.exec(command, (err, stream) => {
      if (err) {
        reject(err);
        return;
      }

      const timer = setTimeout(() => {
        stream.destroy();
        reject(new Error(`Command timed out after ${timeout}ms`));
      }, timeout);

      stream
        .on("close", (code: number | null) => {
          clearTimeout(timer);
          resolve({ stdout, stderr, exitCode: code });
        })
        .on("data", (data: Buffer) => {
          stdout += data.toString();
        })
        .stderr.on("data", (data: Buffer) => {
          stderr += data.toString();
        });
    });
  });
}

export async function execWithCreds(
  creds: SshCredentials,
  command: string,
  timeout = 30000
): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
  const client = new Client();

  return new Promise((resolve, reject) => {
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

    client
      .on("ready", () => {
        let stdout = "";
        let stderr = "";

        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }

          const timer = setTimeout(() => {
            stream.destroy();
            client.end();
            reject(new Error(`Command timed out after ${timeout}ms`));
          }, timeout);

          stream
            .on("close", (code: number | null) => {
              clearTimeout(timer);
              client.end();
              resolve({ stdout, stderr, exitCode: code });
            })
            .on("data", (data: Buffer) => {
              stdout += data.toString();
            })
            .stderr.on("data", (data: Buffer) => {
              stderr += data.toString();
            });
        });
      })
      .on("error", reject)
      .connect(config);
  });
}

export async function sftpReadFile(creds: SshCredentials, remotePath: string): Promise<string> {
  const client = new Client();

  return new Promise((resolve, reject) => {
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

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) { client.end(); reject(err); return; }

        sftp.readFile(remotePath, "utf8", (err2, data) => {
          client.end();
          if (err2) { reject(err2); return; }
          resolve(data as string);
        });
      });
    }).on("error", reject).connect(config);
  });
}

export async function sftpWriteFile(creds: SshCredentials, remotePath: string, content: string): Promise<void> {
  const client = new Client();

  return new Promise((resolve, reject) => {
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

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) { client.end(); reject(err); return; }

        sftp.writeFile(remotePath, content, (err2) => {
          client.end();
          if (err2) { reject(err2); return; }
          resolve();
        });
      });
    }).on("error", reject).connect(config);
  });
}

export async function sftpListDir(creds: SshCredentials, remotePath: string): Promise<Array<{
  name: string;
  path: string;
  type: string;
  size: number;
  modifiedAt: string;
}>> {
  const client = new Client();

  return new Promise((resolve, reject) => {
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

    client.on("ready", () => {
      client.sftp((err, sftp) => {
        if (err) { client.end(); reject(err); return; }

        sftp.readdir(remotePath, (err2, list) => {
          client.end();
          if (err2) { reject(err2); return; }

          const entries = list.map((item) => {
            const isDir = item.attrs.isDirectory?.() ?? (item.longname[0] === "d");
            const isLink = item.longname[0] === "l";
            return {
              name: item.filename,
              path: `${remotePath.replace(/\/$/, "")}/${item.filename}`,
              type: isLink ? "symlink" : isDir ? "directory" : "file",
              size: item.attrs.size ?? 0,
              modifiedAt: new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
            };
          });

          resolve(entries);
        });
      });
    }).on("error", reject).connect(config);
  });
}

export async function execStreaming(
  creds: SshCredentials,
  command: string,
  onData: (chunk: string) => void
): Promise<() => void> {
  const client = new Client();

  return new Promise((resolve, reject) => {
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

    client
      .on("ready", () => {
        client.exec(command, (err, stream) => {
          if (err) {
            client.end();
            reject(err);
            return;
          }

          stream
            .on("data", (data: Buffer) => { onData(data.toString()); })
            .stderr.on("data", (data: Buffer) => { onData(data.toString()); });

          stream.on("close", () => { client.end(); });

          const stop = () => {
            try { stream.destroy(); } catch {}
            try { client.end(); } catch {}
          };

          resolve(stop);
        });
      })
      .on("error", reject)
      .connect(config);
  });
}

export function disconnect(id: number): void {
  const session = sessions.get(id);
  if (session) {
    session.client.end();
    sessions.delete(id);
  }
}
