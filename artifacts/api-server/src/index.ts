import http from "http";
import app from "./app";
import { logger } from "./lib/logger";
import { setupWebSocketTerminal } from "./lib/wsTerminal";
import { startGoalScheduler } from "./lib/goalScheduler";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = http.createServer(app);

setupWebSocketTerminal(server);

server.listen(port, () => {
  logger.info({ port }, "Server listening");
  startGoalScheduler();
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});
