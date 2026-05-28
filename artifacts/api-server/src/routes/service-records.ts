import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, serviceRecordsTable, vehiclesTable } from "@workspace/db";
import {
  ListServiceRecordsParams,
  CreateServiceRecordParams,
  CreateServiceRecordBody,
  GetServiceRecordParams,
  DeleteServiceRecordParams,
} from "@workspace/api-zod";

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
    .where(eq(serviceRecordsTable.vehicleId, params.data.id))
    .orderBy(serviceRecordsTable.date);

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

  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, params.data.id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const [record] = await db
    .insert(serviceRecordsTable)
    .values({ ...parsed.data, vehicleId: params.data.id })
    .returning();

  // Update vehicle service fields based on what was done
  const updates: Partial<typeof vehiclesTable.$inferInsert> = {};
  if (parsed.data.km) updates.currentKm = parsed.data.km;
  if (parsed.data.oilChanged) {
    updates.lastOilChangeDate = parsed.data.date;
    if (parsed.data.km) updates.lastOilChangeKm = parsed.data.km;
  }
  if (parsed.data.brakesServiced) updates.lastBrakesDate = parsed.data.date;
  if (parsed.data.timingServiced) updates.lastTimingDate = parsed.data.date;

  if (Object.keys(updates).length > 0) {
    await db.update(vehiclesTable).set(updates).where(eq(vehiclesTable.id, params.data.id));
  }

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
    .where(eq(serviceRecordsTable.id, params.data.id));

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

  const [record] = await db
    .delete(serviceRecordsTable)
    .where(eq(serviceRecordsTable.id, params.data.id))
    .returning();

  if (!record) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  res.sendStatus(204);
});

export default router;
