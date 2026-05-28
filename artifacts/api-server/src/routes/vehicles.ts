import { Router, type IRouter } from "express";
import { eq, ilike, or } from "drizzle-orm";
import { db, vehiclesTable, serviceRecordsTable, workOrdersTable } from "@workspace/db";
import {
  ListVehiclesQueryParams,
  CreateVehicleBody,
  GetVehicleByPlateParams,
  GetVehicleParams,
  UpdateVehicleParams,
  UpdateVehicleBody,
  DeleteVehicleParams,
} from "@workspace/api-zod";
import { normalizeSpz } from "../lib/spz";

const router: IRouter = Router();

router.get("/vehicles", async (req, res): Promise<void> => {
  const query = ListVehiclesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  let vehicles;
  if (query.data.search) {
    const s = `%${query.data.search}%`;
    vehicles = await db
      .select()
      .from(vehiclesTable)
      .where(
        or(
          ilike(vehiclesTable.licensePlate, s),
          ilike(vehiclesTable.make, s),
          ilike(vehiclesTable.model, s),
        ),
      )
      .orderBy(vehiclesTable.licensePlate);
  } else {
    vehicles = await db.select().from(vehiclesTable).orderBy(vehiclesTable.licensePlate);
  }

  res.json(vehicles);
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const values = { ...parsed.data, licensePlate: normalizeSpz(parsed.data.licensePlate) };
  const [vehicle] = await db.insert(vehiclesTable).values(values).returning();
  res.status(201).json(vehicle);
});

router.get("/vehicles/by-plate/:plate", async (req, res): Promise<void> => {
  const params = GetVehicleByPlateParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(ilike(vehiclesTable.licensePlate, params.data.plate));

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  res.json(vehicle);
});

router.get("/vehicles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = GetVehicleParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db
    .select()
    .from(vehiclesTable)
    .where(eq(vehiclesTable.id, params.data.id));

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const serviceRecords = await db
    .select()
    .from(serviceRecordsTable)
    .where(eq(serviceRecordsTable.vehicleId, params.data.id))
    .orderBy(serviceRecordsTable.date);

  const openWorkOrders = await db
    .select()
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vehicleId, params.data.id));

  res.json({ ...vehicle, serviceRecords, openWorkOrders });
});

router.patch("/vehicles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = UpdateVehicleParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const parsed = UpdateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const updates = parsed.data.licensePlate
    ? { ...parsed.data, licensePlate: normalizeSpz(parsed.data.licensePlate) }
    : parsed.data;

  const [vehicle] = await db
    .update(vehiclesTable)
    .set(updates)
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  res.json(vehicle);
});

router.delete("/vehicles/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const params = DeleteVehicleParams.safeParse({ id });
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  const [vehicle] = await db
    .delete(vehiclesTable)
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  res.sendStatus(204);
});

export default router;
