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
import { normalizeSpz } from "../lib/spz";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const storage = new ObjectStorageService();

async function getWorkOrderWithPhotos(id: number) {
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, id));
  if (!order) return null;
  const photos = await db.select().from(photosTable).where(eq(photosTable.workOrderId, id));
  return { ...order, photos };
}

/**
 * Propagate completed/recorded service items from a work order into the vehicle's
 * status fields (current km, last service dates, last oil km).
 * Only overwrites when the new date is strictly newer or the field is empty.
 */
async function propagateWorkOrderToVehicle(orderId: number): Promise<void> {
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, orderId));
  if (!order || !order.vehicleId) return;
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, order.vehicleId));
  if (!vehicle) return;

  const today = new Date().toISOString().slice(0, 10);
  const serviceDate = order.serviceDate ?? today;

  const updates: Partial<typeof vehiclesTable.$inferInsert> = {};
  const isNewer = (existing: string | null) => !existing || serviceDate >= existing;

  if (order.km != null && (vehicle.currentKm == null || order.km > vehicle.currentKm)) {
    updates.currentKm = order.km;
  }
  if (order.oilChange && isNewer(vehicle.lastOilChangeDate)) {
    updates.lastOilChangeDate = serviceDate;
    if (order.km != null) updates.lastOilChangeKm = order.km;
  }
  if (order.transmissionOil && isNewer(vehicle.lastTransmissionOilDate)) {
    updates.lastTransmissionOilDate = serviceDate;
    if (order.km != null) updates.lastTransmissionOilKm = order.km;
  }
  if (order.brakes && isNewer(vehicle.lastBrakesDate)) {
    updates.lastBrakesDate = serviceDate;
  }
  if (order.timing && isNewer(vehicle.lastTimingDate)) {
    updates.lastTimingDate = serviceDate;
  }
  if (order.brakeFluid && isNewer(vehicle.lastBrakeFluidDate)) {
    updates.lastBrakeFluidDate = serviceDate;
  }

  if (Object.keys(updates).length === 0) return;
  await db.update(vehiclesTable).set(updates).where(eq(vehiclesTable.id, vehicle.id));
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
    .orderBy(sql`coalesce(${workOrdersTable.serviceDate}, ${workOrdersTable.createdAt}::date) desc, ${workOrdersTable.createdAt} desc`);

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
  const plate = normalizeSpz(parsed.data.licensePlate);
  const [vehicle] = await db.select().from(vehiclesTable).where(ilike(vehiclesTable.licensePlate, plate));

  const [order] = await db.insert(workOrdersTable).values({
    ...parsed.data,
    licensePlate: plate,
    vehicleId: vehicle?.id ?? null,
    oilChange: parsed.data.oilChange ?? false,
    brakes: parsed.data.brakes ?? false,
    timing: parsed.data.timing ?? false,
    airFilter: parsed.data.airFilter ?? false,
    cabinFilter: parsed.data.cabinFilter ?? false,
    stk: parsed.data.stk ?? false,
    tireChange: parsed.data.tireChange ?? false,
    diagnostics: parsed.data.diagnostics ?? false,
    lightsCheck: parsed.data.lightsCheck ?? false,
    brakeFluid: parsed.data.brakeFluid ?? false,
    frontAxleCheck: parsed.data.frontAxleCheck ?? false,
    rearAxleCheck: parsed.data.rearAxleCheck ?? false,
  }).returning();

  await propagateWorkOrderToVehicle(order.id);

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
  } else if (parsed.data.status) {
    updateData.completedAt = null;
  }

  const [order] = await db.update(workOrdersTable).set(updateData)
    .where(eq(workOrdersTable.id, params.data.id)).returning();

  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  await propagateWorkOrderToVehicle(order.id);

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
