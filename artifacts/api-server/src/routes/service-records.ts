import { Router, type IRouter } from "express";
import { eq, desc, and, isNull } from "drizzle-orm";
import { db, serviceRecordsTable, vehiclesTable } from "@workspace/db";
import { auditEntity } from "../lib/audit";
import { getActor } from "../lib/actor";
import {
  ListServiceRecordsParams,
  CreateServiceRecordParams,
  CreateServiceRecordBody,
  GetServiceRecordParams,
  DeleteServiceRecordParams,
} from "@workspace/api-zod";
import { recomputeVehicleServiceStatus } from "../lib/vehicleStatus";

const router: IRouter = Router();

router.get("/vehicles/:id/service-records", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = ListServiceRecordsParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const records = await db
    .select()
    .from(serviceRecordsTable)
    .where(and(eq(serviceRecordsTable.vehicleId, params.data.id), isNull(serviceRecordsTable.deletedAt)))
    .orderBy(desc(serviceRecordsTable.date), desc(serviceRecordsTable.id));

  res.json(records);
});

router.post("/vehicles/:id/service-records", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = CreateServiceRecordParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = CreateServiceRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [vehicle] = await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, params.data.id), isNull(vehiclesTable.deletedAt)));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const [record] = await db
    .insert(serviceRecordsTable)
    .values({ ...parsed.data, vehicleId: params.data.id })
    .returning();

  await recomputeVehicleServiceStatus(params.data.id);

  await auditEntity.created("service_record", record.id, getActor(req), record, vehicle.licensePlate);

  res.status(201).json(record);
});

router.get("/service-records/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = GetServiceRecordParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [record] = await db
    .select()
    .from(serviceRecordsTable)
    .where(and(eq(serviceRecordsTable.id, params.data.id), isNull(serviceRecordsTable.deletedAt)));

  if (!record) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  res.json(record);
});

router.delete("/service-records/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = DeleteServiceRecordParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  const actor = getActor(req);
  const [record] = await db
    .update(serviceRecordsTable)
    .set({ deletedAt: new Date(), deletedBy: actor, deleteReason: reason })
    .where(and(eq(serviceRecordsTable.id, params.data.id), isNull(serviceRecordsTable.deletedAt)))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  await auditEntity.deleted("service_record", record.id, actor, record);

  await recomputeVehicleServiceStatus(record.vehicleId);

  res.sendStatus(204);
});

export default router;
