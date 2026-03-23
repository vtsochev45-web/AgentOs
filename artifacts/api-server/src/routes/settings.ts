import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { appSettingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { encrypt, decrypt } from "../lib/encryption";

const router: IRouter = Router();

function safeDecrypt(value: string | null | undefined): string | null {
  if (!value) return null;
  try { return decrypt(value); } catch { return null; }
}

router.get("/settings", async (req, res): Promise<void> => {
  const [settings] = await db.select().from(appSettingsTable).limit(1);
  if (!settings) {
    res.json({
      aiModel: "gpt-5.2",
      smtpHost: null,
      smtpPort: null,
      smtpUser: null,
      smtpConfigured: false,
      webhookUrl: null,
      searchProvider: "duckduckgo",
      braveApiKeyConfigured: false,
    });
    return;
  }

  res.json({
    aiModel: settings.aiModel,
    smtpHost: settings.smtpHost,
    smtpPort: settings.smtpPort,
    smtpUser: settings.smtpUser,
    smtpConfigured: !!(settings.smtpHost && settings.smtpUser && settings.smtpPassword),
    webhookUrl: settings.webhookUrl,
    searchProvider: settings.searchProvider,
    braveApiKeyConfigured: !!settings.braveApiKey,
  });
});

router.put("/settings", async (req, res): Promise<void> => {
  const {
    aiModel, smtpHost, smtpPort, smtpUser, smtpPassword,
    webhookUrl, searchProvider, braveApiKey,
  } = req.body as {
    aiModel?: string; smtpHost?: string; smtpPort?: number; smtpUser?: string;
    smtpPassword?: string; webhookUrl?: string; searchProvider?: string; braveApiKey?: string;
  };

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (aiModel !== undefined) updates.aiModel = aiModel;
  if (smtpHost !== undefined) updates.smtpHost = smtpHost;
  if (smtpPort !== undefined) updates.smtpPort = smtpPort;
  if (smtpUser !== undefined) updates.smtpUser = smtpUser;
  if (smtpPassword !== undefined && smtpPassword !== "") updates.smtpPassword = encrypt(smtpPassword);
  if (webhookUrl !== undefined) updates.webhookUrl = webhookUrl;
  if (searchProvider !== undefined) updates.searchProvider = searchProvider;
  if (braveApiKey !== undefined && braveApiKey !== "") updates.braveApiKey = encrypt(braveApiKey);

  const [existing] = await db.select().from(appSettingsTable).limit(1);
  let settings;
  if (existing) {
    [settings] = await db.update(appSettingsTable).set(updates).where(eq(appSettingsTable.id, existing.id)).returning();
  } else {
    [settings] = await db.insert(appSettingsTable).values(updates as Record<string, unknown>).returning();
  }

  res.json({
    aiModel: settings!.aiModel,
    smtpHost: settings!.smtpHost,
    smtpPort: settings!.smtpPort,
    smtpUser: settings!.smtpUser,
    smtpConfigured: !!(settings!.smtpHost && settings!.smtpUser && settings!.smtpPassword),
    webhookUrl: settings!.webhookUrl,
    searchProvider: settings!.searchProvider,
    braveApiKeyConfigured: !!settings!.braveApiKey,
  });
});

export { safeDecrypt };
export default router;
