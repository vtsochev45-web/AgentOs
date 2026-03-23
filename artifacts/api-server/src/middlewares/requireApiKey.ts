import type { Request, Response, NextFunction } from "express";

const API_KEY = process.env.OPENCLAW_API_KEY;

export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) {
    next();
    return;
  }

  const key = req.headers["x-api-key"] ?? req.query["api_key"];
  if (!key || key !== API_KEY) {
    res.status(401).json({ error: "Unauthorized: invalid or missing API key" });
    return;
  }

  next();
}
