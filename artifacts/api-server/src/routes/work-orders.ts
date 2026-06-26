import { Router, type IRouter, type Request, type Response } from "express";
import { eq, ne, ilike, and, sql, isNull } from "drizzle-orm";
import multer from "multer";
import { db, workOrdersTable, vehiclesTable, photosTable, loanersTable } from "@workspace/db";
import { getObjectStorageService } from "../lib/storage";
import { validateImageUpload } from "../lib/fileValidation";
import { auditEntity } from "../lib/audit";
import { getActor } from "../lib/actor";
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
import { recomputeVehicleServiceStatus } from "../lib/vehicleStatus";

const router: IRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });
const storage = getObjectStorageService();

async function getWorkOrderWithPhotos(id: number) {
  const [order] = await db
    .select()
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.id, id), isNull(workOrdersTable.deletedAt)));
  if (!order) return null;
  const photos = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.workOrderId, id), isNull(photosTable.deletedAt)));
  return { ...order, photos };
}

/**
 * Recompute vehicle status fields from full service history (records + completed orders).
 */
async function propagateWorkOrderToVehicle(orderId: number): Promise<void> {
  const [order] = await db.select().from(workOrdersTable).where(eq(workOrdersTable.id, orderId));
  if (!order || !order.vehicleId) return;
  await recomputeVehicleServiceStatus(order.vehicleId);
}

export const listWorkOrdersHandler = async (req: Request, res: Response): Promise<void> => {
  const query = ListWorkOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conditions = [isNull(workOrdersTable.deletedAt)];
  if (query.data.status) conditions.push(eq(workOrdersTable.status, query.data.status));

  let rows = await db
    .select({
      order: workOrdersTable,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
      ownerName: vehiclesTable.ownerName,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(sql`coalesce(${workOrdersTable.serviceDate}, ${workOrdersTable.createdAt}::date) desc, ${workOrdersTable.createdAt} desc`);

  if (query.data.search) {
    const s = query.data.search.toLowerCase();
    // SPZ is stored canonically as "XXX XXXX" (with a space); match space-insensitively
    // so a compact query like "1AB2345" still finds the stored "1AB 2345" and vice versa.
    const sCompact = s.replace(/\s+/g, "");
    rows = rows.filter(r => {
      const plate = r.order.licensePlate.toLowerCase();
      return (
        plate.includes(s) ||
        (sCompact.length > 0 && plate.replace(/\s+/g, "").includes(sCompact)) ||
        r.order.description?.toLowerCase().includes(s) ||
        r.make?.toLowerCase().includes(s) ||
        r.model?.toLowerCase().includes(s) ||
        r.ownerName?.toLowerCase().includes(s)
      );
    });
  }

  const withPhotos = await Promise.all(rows.map(async (r) => {
    const photos = await db
      .select()
      .from(photosTable)
      .where(and(eq(photosTable.workOrderId, r.order.id), isNull(photosTable.deletedAt)));
    return { ...r.order, make: r.make ?? null, model: r.model ?? null, ownerName: r.ownerName ?? null, photos };
  }));

  res.json(withPhotos);
};
router.get("/work-orders", listWorkOrdersHandler);

/**
 * Scoped work-order lookup for the scanner role's material-scan workflow.
 *
 * Registered on scannerRouter (routes/index.ts) under requireScannerOrAdmin. A
 * scanner only needs to find the OPEN work order for the single SPZ they just
 * scanned, so this handler — unlike the admin listWorkOrdersHandler — refuses to
 * act as an unfiltered list:
 *  - it requires a plate-like query (>= 3 compacted chars); without one it
 *    returns [] instead of enumerating every order;
 *  - it matches on the license plate only (space-insensitive), never on
 *    description/make/model/owner;
 *  - it returns only non-completed (open) orders;
 *  - it omits the vehicle join, so no owner/make/model PII is exposed (those
 *    keys are present but null to keep the response shape identical to the admin
 *    list, which the shared useListWorkOrders hook consumes).
 */
export const lookupOpenWorkOrdersForScannerHandler = async (
  req: Request,
  res: Response,
): Promise<void> => {
  const query = ListWorkOrdersQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const sCompact = (query.data.search ?? "").replace(/\s+/g, "").toLowerCase();
  if (sCompact.length < 3) {
    res.json([]);
    return;
  }

  const rows = await db
    .select()
    .from(workOrdersTable)
    .where(and(ne(workOrdersTable.status, "completed"), isNull(workOrdersTable.deletedAt)))
    .orderBy(
      sql`coalesce(${workOrdersTable.serviceDate}, ${workOrdersTable.createdAt}::date) desc, ${workOrdersTable.createdAt} desc`,
    );

  // Exact compacted-plate equality (NOT a substring match): a scanner must not
  // be able to probe partial plates to enumerate other vehicles' open orders.
  const matches = rows
    .filter((o) => o.licensePlate.replace(/\s+/g, "").toLowerCase() === sCompact)
    .map((o) => ({ ...o, make: null, model: null, ownerName: null, photos: [] }));

  res.json(matches);
};

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
    paid: parsed.data.paid ?? false,
    oilChange: parsed.data.oilChange ?? false,
    brakes: parsed.data.brakes ?? false,
    timing: parsed.data.timing ?? false,
    airFilter: parsed.data.airFilter ?? false,
    cabinFilter: parsed.data.cabinFilter ?? false,
    fuelFilter: parsed.data.fuelFilter ?? false,
    sparkPlugs: parsed.data.sparkPlugs ?? false,
    stk: parsed.data.stk ?? false,
    tireChange: parsed.data.tireChange ?? false,
    diagnostics: parsed.data.diagnostics ?? false,
    lightsCheck: parsed.data.lightsCheck ?? false,
    brakeFluid: parsed.data.brakeFluid ?? false,
    frontAxleCheck: parsed.data.frontAxleCheck ?? false,
    rearAxleCheck: parsed.data.rearAxleCheck ?? false,
    frontShocksCheck: parsed.data.frontShocksCheck ?? false,
    rearShocksCheck: parsed.data.rearShocksCheck ?? false,
    geometry: parsed.data.geometry ?? false,
    headlightAlignment: parsed.data.headlightAlignment ?? false,
  }).returning();

  await propagateWorkOrderToVehicle(order.id);

  await auditEntity.created("work_order", order.id, getActor(req), order, order.licensePlate);

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

  const [existing] = await db
    .select()
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.id, params.data.id), isNull(workOrdersTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  const updateData: Partial<typeof workOrdersTable.$inferInsert> = { ...parsed.data };
  if (parsed.data.status === "completed") {
    updateData.completedAt = new Date();
  } else if (parsed.data.status) {
    updateData.completedAt = null;
  }

  const [order] = await db.update(workOrdersTable).set(updateData)
    .where(eq(workOrdersTable.id, params.data.id)).returning();

  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  await auditEntity.updated("work_order", order.id, getActor(req), existing, order.licensePlate);

  // When the work order is marked as invoiced (Vyfakturováno / paid), any
  // active loaner running off this work order is auto-returned today — unless
  // the user already set the return date by hand (manualEndDate).
  if (parsed.data.paid === true) {
    const today = new Date().toISOString().slice(0, 10);
    await db.update(loanersTable)
      .set({ endDate: today, status: "returned" })
      .where(and(
        eq(loanersTable.workOrderId, order.id),
        eq(loanersTable.status, "active"),
        eq(loanersTable.manualEndDate, false),
      ));
  }

  await propagateWorkOrderToVehicle(order.id);

  const photos = await db.select().from(photosTable).where(and(eq(photosTable.workOrderId, order.id), isNull(photosTable.deletedAt)));
  res.json({ ...order, photos });
});

router.delete("/work-orders/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeleteWorkOrderParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  const actor = getActor(req);
  const [order] = await db
    .update(workOrdersTable)
    .set({ deletedAt: new Date(), deletedBy: actor, deleteReason: reason })
    .where(and(eq(workOrdersTable.id, params.data.id), isNull(workOrdersTable.deletedAt)))
    .returning();
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }
  await auditEntity.deleted("work_order", order.id, actor, order, order.licensePlate);
  if (order.vehicleId) await recomputeVehicleServiceStatus(order.vehicleId);
  res.sendStatus(204);
});

// Photos
router.get("/work-orders/:id/photos", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = ListWorkOrderPhotosParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const photos = await db
    .select()
    .from(photosTable)
    .where(and(eq(photosTable.workOrderId, params.data.id), isNull(photosTable.deletedAt)));
  res.json(photos);
});

router.post("/work-orders/:id/photos", upload.single("photo"), async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  if (!req.file) { res.status(400).json({ error: "No file uploaded" }); return; }

  const validation = validateImageUpload(req.file);
  if (!validation.ok) { res.status(400).json({ error: validation.error }); return; }

  const [order] = await db.select().from(workOrdersTable).where(and(eq(workOrdersTable.id, id), isNull(workOrdersTable.deletedAt)));
  if (!order) { res.status(404).json({ error: "Zakázka nenalezena" }); return; }

  try {
    const objectPath = await storage.uploadPrivateObject(req.file.buffer, req.file.mimetype);

    const filename = `photo_${Date.now()}${validation.ext}`;

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

  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  const actor = getActor(req);
  const [photo] = await db
    .update(photosTable)
    .set({ deletedAt: new Date(), deletedBy: actor, deleteReason: reason })
    .where(and(eq(photosTable.id, params.data.id), isNull(photosTable.deletedAt)))
    .returning();
  if (!photo) { res.status(404).json({ error: "Fotka nenalezena" }); return; }
  await auditEntity.deleted("photo", photo.id, actor, photo, photo.filename);
  res.sendStatus(204);
});

export default router;
