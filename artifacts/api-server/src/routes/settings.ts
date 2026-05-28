import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import multer from "multer";
import path from "path";
import { db, settingsTable } from "@workspace/db";
import { UpdateSettingsBody } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });
const storage = new ObjectStorageService();

async function getOrCreate() {
  const [existing] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (existing) return existing;
  const [created] = await db.insert(settingsTable).values({ id: 1 }).returning();
  return created;
}

router.get("/settings", async (_req, res): Promise<void> => {
  const row = await getOrCreate();
  res.json(row);
});

router.put("/settings", async (req, res): Promise<void> => {
  const parsed = UpdateSettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  await getOrCreate();

  const data: Partial<typeof settingsTable.$inferInsert> = {};
  for (const [k, v] of Object.entries(parsed.data)) {
    if (v !== undefined && v !== null) (data as any)[k] = v;
    else if (v === null && ["companyName","companyAddress","companyPhone","companyEmail","companyIco","companyDic","logoUrl","signatureName","signatureImageUrl","primaryColor"].includes(k)) {
      (data as any)[k] = null;
    }
  }
  data.updatedAt = new Date();

  const [row] = await db.update(settingsTable).set(data).where(eq(settingsTable.id, 1)).returning();
  res.json(row);
});

async function handleImageUpload(req: Express.Request & { file?: Express.Multer.File; log: any }, res: any, column: "logoUrl" | "signatureImageUrl", errLabel: string) {
  if (!req.file) { res.status(400).json({ error: "Žádný soubor" }); return; }
  try {
    const uploadUrl = await storage.getObjectEntityUploadURL();
    const uploadResponse = await fetch(uploadUrl, {
      method: "PUT",
      body: req.file.buffer,
      headers: { "Content-Type": req.file.mimetype },
    });
    if (!uploadResponse.ok) throw new Error("GCS upload failed");

    const url = new URL(uploadUrl);
    const objectPath = storage.normalizeObjectEntityPath(url.origin + url.pathname);

    await getOrCreate();
    const [row] = await db.update(settingsTable)
      .set({ [column]: objectPath, updatedAt: new Date() } as any)
      .where(eq(settingsTable.id, 1)).returning();
    res.json(row);
  } catch (err) {
    req.log.error({ err }, `${errLabel} upload failed`);
    res.status(500).json({ error: `Nahrání ${errLabel} selhalo` });
  }
}

router.post("/settings/logo", upload.single("logo"), async (req, res): Promise<void> => {
  await handleImageUpload(req as any, res, "logoUrl", "loga");
});

router.post("/settings/signature", upload.single("signature"), async (req, res): Promise<void> => {
  await handleImageUpload(req as any, res, "signatureImageUrl", "podpisu");
});

export default router;
