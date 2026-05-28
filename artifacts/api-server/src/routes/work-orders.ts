import { Router, type IRouter } from "express";
import { eq, ilike, and, sql } from "drizzle-orm";
import multer from "multer";
import path from "path";
import { db, workOrdersTable, vehiclesTable, photosTable } from "@workspace/db";
import { ObjectStorageService } from "../lib/objectStorage";
import {
  ListWorkOrdersQueryParams,
  CreateWorkOrderBody,
  GetWorkOrderParams,
  UpdateWorkOrderParams,
  UpdateWorkOrderBody,
  DeleteWorkOrderParams,
  ListWorkOrderPhotosParams,
  DeletePhotoParams,
} from "@workspace/api-zod";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const storage = new ObjectStorageService();

async function getWorkOrderWithPhotos(id: number) {
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) return null;
  const photos = await db.select().from(photosTable).where(eq(photosTable.workOrderId, id));
  return { ...order, photos };
}

router.get("/work-orders", async (req, res): Promise<void> => {
  const query = ListWorkOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let orders;
  const conditions = [];
  if (query.data.status) conditions.push(eq(workOrdersTable.status, query.data.status));

  orders = await db.select().from(workOrdersTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`${workOrdersTable.createdAt} desc`);

  if (query.data.search) {
    const s = query.data.search.toLowerCase();
    orders = orders.filter(o =>
      o.licensePlate.toLowerCase().includes(s) ||
      o.description?.toLowerCase().includes(s)
    );
  }

  const withPhotos = await Promise.all(orders.map(async (o) => {
    const photos = await db.select().from(photosTable).where(eq(photosTable.workOrderId, o.id));
    return { ...o, photos };
  }));

  res.json(withPhotos);
});

router.post("/work-orders", async (req, res): Promise<void> => {
  const parsed = CreateWorkOrderBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Try to link to existing vehicle by plate
  const plate = parsed.data.licensePlate.toUpperCase().trim();
  const [vehicle] = await db.select().from(vehiclesTable).where(ilike(vehiclesTable.licensePlate, plate));

  const [order] = await db.insert(workOrdersTable).values({
    ...parsed.data,
    licensePlate: plate,
    vehicleId: vehicle?.id ?? null,
    oilChange: parsed.data.oilChange ?? false,
    brakes: parsed.data.brakes ?? false,
    timing: parsed.data.timing ?? false,
    stk: parsed.data.stk ?? false,
  }).returning();

  res.status(201).json({ ...order, photos: [] });
});

router.get("/work-orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = GetWorkOrderParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const order = await getWorkOrderWithPhotos(params.data.id);
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  res.json(order);
});

router.patch("/work-orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = UpdateWorkOrderParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateWorkOrderBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const updateData: Partial<typeof workOrdersTable.$inferInsert> = { ...parsed.data };
  if (parsed.data.status === "completed") {
    updateData.completedAt = new Date();
  } else if (parsed.data.status && parsed.data.status !== "completed") {
    updateData.completedAt = null;
  }

  const [order] = await db.update(workOrdersTable).set(updateData)
    .where(eq(workOrdersTable.id, params.data.id)).returning();

  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  const photos = await db.select().from(photosTable).where(eq(photosTable.workOrderId, order.id));
  res.json({ ...order, photos });
});

router.delete("/work-orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeleteWorkOrderParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [order] = await db.delete(workOrdersTable).where(eq(workOrdersTable.id, params.data.id)).returning();
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }
  res.sendStatus(204);
});

// Photos
router.get("/work-orders/:id/photos", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = ListWorkOrderPhotosParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const photos = await db.select().from(photosTable).where(eq(photosTable.workOrderId, params.data.id));
  res.json(photos);
});

router.post("/work-orders/:id/photos", upload.single("photo"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

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

    const ext = path.extname(req.file.originalname) || ".jpg";
    const filename = `photo_${Date.now()}${ext}`;

    const [photo] = await db.insert(photosTable).values({
      workOrderId: id,
      url: objectPath,
      filename,
    }).returning();

    res.status(201).json(photo);
  } catch (err) {
    req.log.error({ err }, "Photo upload failed");
    res.status(500).json({ error: "Upload selhal" });
  }
});

router.delete("/photos/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeletePhotoParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const [photo] = await db.delete(photosTable).where(eq(photosTable.id, params.data.id)).returning();
  if (!photo) { res.status(404).json({ error: "Fotka nenalezena" }); return; }
  res.sendStatus(204);
});

export default router;
