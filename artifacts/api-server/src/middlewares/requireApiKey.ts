import type { Request, Response, NextFunction } from "express";
import { logger } from "../lib/logger";

const API_KEY = process.env.OPENCLAW_API_KEY;
const IS_DEV = process.env.NODE_ENV === "development";

if (!API_KEY) {
  if (IS_DEV) {
    logger.warn("OPENCLAW_API_KEY is not set — all privileged endpoints are unprotected in development mode");
  } else {
    logger.warn("OPENCLAW_API_KEY is not set — privileged endpoints require this key to be set in production");
  }
}

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    if (!IS_DEV) {
      res.status(401).json({ error: "Unauthorized: OPENCLAW_API_KEY is not configured on the server" });
      return;
    }
    next();
    return;
  }

  const key = (req.headers["x-api-key"] as string | undefined) ?? (req.query["api_key"] as string | undefined);
  if (!key || key !== API_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    return;
  }

  next();
}

export function validateWsApiKey(url: string): boolean {
  if (!API_KEY) {
    return IS_DEV;
  }
  const parsed = new URL(url, "http://localhost");
  const key = parsed.searchParams.get("api_key");
  return key === API_KEY;
}
