import { Router, type IRouter } from "express";
import { requireApiKey } from "../middlewares/requireApiKey";
import fs from "fs/promises";
import path from "path";

const router: IRouter = Router();

const SKILLS_DIR = path.resolve(process.cwd(), "../../.local/skills");

router.get("/skills", requireApiKey, async (req, res): Promise<void> => {
  try {
    const entries = await fs.readdir(SKILLS_DIR, { withFileTypes: true });
    const skills = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const skillMdPath = path.join(SKILLS_DIR, entry.name, "SKILL.md");
      try {
        const stat = await fs.stat(skillMdPath);
        skills.push({
          name: entry.name,
          hasSkillMd: true,
          sizeBytes: stat.size,
          updatedAt: stat.mtime,
        });
      } catch {
        skills.push({ name: entry.name, hasSkillMd: false, sizeBytes: 0, updatedAt: null });
      }
    }
    res.json(skills);
  } catch (err) {
    res.status(500).json({ error: "Failed to list skills", detail: String(err) });
  }
});

router.get("/skills/:name", requireApiKey, async (req, res): Promise<void> => {
  const { name } = req.params;
  if (!/^[\w-]+$/.test(name)) { res.status(400).json({ error: "Invalid skill name" }); return; }
  const skillMdPath = path.join(SKILLS_DIR, name, "SKILL.md");
  try {
    const content = await fs.readFile(skillMdPath, "utf-8");
    res.json({ name, content });
  } catch {
    res.status(404).json({ error: "Skill not found" });
  }
});

router.put("/skills/:name", requireApiKey, async (req, res): Promise<void> => {
  const { name } = req.params;
  if (!/^[\w-]+$/.test(name)) { res.status(400).json({ error: "Invalid skill name" }); return; }
  const { content } = req.body as { content?: string };
  if (typeof content !== "string") { res.status(400).json({ error: "content is required" }); return; }
  const skillMdPath = path.join(SKILLS_DIR, name, "SKILL.md");
  try {
    await fs.writeFile(skillMdPath, content, "utf-8");
    res.json({ ok: true, name });
  } catch (err) {
    res.status(500).json({ error: "Failed to write skill", detail: String(err) });
  }
});

export default router;
