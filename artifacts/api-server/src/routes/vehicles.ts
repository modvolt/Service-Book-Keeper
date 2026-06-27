import { Router, type IRouter } from "express";
import { eq, ilike, or, desc, and, isNull } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceRecordsTable,
  workOrdersTable,
  appointmentsTable,
  loanersTable,
  customerReminderLogTable,
} from "@workspace/db";
import { auditEntity, type AuditActor } from "../lib/audit";
import { getActor } from "../lib/actor";
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
import { recomputeVehicleServiceStatus } from "../lib/vehicleStatus";
import { cascadeSoftDeleteWorkOrderChildren } from "./work-orders";

const router: IRouter = Router();

const FLEET_OWNER_NAME = "Martin Junek";

router.get("/vehicles", async (req, res): Promise<void> => {
  const query = ListVehiclesQueryParams.safeParse(req.query);
  if (!query.success) {
    res.status(400).json({ error: query.error.message });
    return;
  }

  const conds = [isNull(vehiclesTable.deletedAt)];
  if (query.data.search) {
    const s = `%${query.data.search}%`;
    conds.push(
      or(
        ilike(vehiclesTable.licensePlate, s),
        ilike(vehiclesTable.make, s),
        ilike(vehiclesTable.model, s),
        ilike(vehiclesTable.ownerName, s),
      )!,
    );
  }
  if (query.data.fleet != null) {
    conds.push(eq(vehiclesTable.isFleet, query.data.fleet));
  }

  const vehicles = await db
    .select()
    .from(vehiclesTable)
    .where(and(...conds))
    .orderBy(vehiclesTable.licensePlate);

  res.json(vehicles);
});

router.post("/vehicles", async (req, res): Promise<void> => {
  const parsed = CreateVehicleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const { ownerType, isFleet, ...rest } = parsed.data;
  const fleet = !!isFleet;
  const ownerOverrides = fleet
    ? {
        ownerType: "private" as const,
        ownerName: FLEET_OWNER_NAME,
        ownerAddress: null,
        ownerIco: null,
        ownerDic: null,
        ownerPhone: null,
        ownerEmail: null,
      }
    : (ownerType ? { ownerType } : {});
  const values = {
    ...rest,
    licensePlate: normalizeSpz(parsed.data.licensePlate),
    ...ownerOverrides,
    isFleet: fleet,
  };
  const [vehicle] = await db.insert(vehiclesTable).values(values).returning();
  await auditEntity.created("vehicle", vehicle.id, getActor(req), vehicle, vehicle.licensePlate);
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
    .where(and(ilike(vehiclesTable.licensePlate, params.data.plate), isNull(vehiclesTable.deletedAt)));

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
    .where(and(eq(vehiclesTable.id, params.data.id), isNull(vehiclesTable.deletedAt)));

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const serviceRecords = await db
    .select()
    .from(serviceRecordsTable)
    .where(and(eq(serviceRecordsTable.vehicleId, params.data.id), isNull(serviceRecordsTable.deletedAt)))
    .orderBy(desc(serviceRecordsTable.date), desc(serviceRecordsTable.id));

  const allWorkOrders = await db
    .select()
    .from(workOrdersTable)
    .where(and(eq(workOrdersTable.vehicleId, params.data.id), isNull(workOrdersTable.deletedAt)))
    .orderBy(desc(workOrdersTable.serviceDate), desc(workOrdersTable.createdAt));

  const openWorkOrders = allWorkOrders.filter(wo => wo.status !== "completed");
  const completedWorkOrders = allWorkOrders.filter(wo => wo.status === "completed");

  res.json({ ...vehicle, serviceRecords, openWorkOrders, completedWorkOrders });
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

  const { ownerType, ...restUpdates } = parsed.data;
  // Fleet status is set only at creation (from Vozový park) and is immutable afterwards.
  delete (restUpdates as Record<string, unknown>).isFleet;

  const [existing] = await db
    .select()
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, params.data.id), isNull(vehiclesTable.deletedAt)));
  if (!existing) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const updates: Record<string, unknown> = { ...restUpdates };
  if (parsed.data.licensePlate) updates.licensePlate = normalizeSpz(parsed.data.licensePlate);
  if (ownerType) updates.ownerType = ownerType;

  // Fleet vehicles are always registered under the fixed owner name.
  if (existing.isFleet) {
    updates.ownerType = "private";
    updates.ownerName = FLEET_OWNER_NAME;
    updates.ownerAddress = null;
    updates.ownerIco = null;
    updates.ownerDic = null;
    updates.ownerPhone = null;
    updates.ownerEmail = null;
  }

  const [vehicle] = await db
    .update(vehiclesTable)
    .set(updates)
    .where(eq(vehiclesTable.id, params.data.id))
    .returning();

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  await auditEntity.updated("vehicle", vehicle.id, getActor(req), existing, vehicle.licensePlate);

  res.json(vehicle);
});

router.post("/vehicles/:id/recompute-status", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const [existing] = await db.select().from(vehiclesTable).where(and(eq(vehiclesTable.id, id), isNull(vehiclesTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Vozidlo nenalezeno" }); return; }

  await recomputeVehicleServiceStatus(id);
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  res.json(vehicle);
});

router.get("/vehicles/:id/reminder-log", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) {
    res.status(400).json({ error: "Invalid ID" });
    return;
  }

  const [vehicle] = await db
    .select({ id: vehiclesTable.id })
    .from(vehiclesTable)
    .where(and(eq(vehiclesTable.id, id), isNull(vehiclesTable.deletedAt)));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  const rows = await db
    .select({
      id: customerReminderLogTable.id,
      reminderKey: customerReminderLogTable.reminderKey,
      sentAt: customerReminderLogTable.sentAt,
    })
    .from(customerReminderLogTable)
    .where(eq(customerReminderLogTable.vehicleId, id))
    .orderBy(desc(customerReminderLogTable.sentAt), desc(customerReminderLogTable.id));

  res.json(rows);
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

  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  const actor = getActor(req);
  const [vehicle] = await db
    .update(vehiclesTable)
    .set({ deletedAt: new Date(), deletedBy: actor, deleteReason: reason })
    .where(and(eq(vehiclesTable.id, params.data.id), isNull(vehiclesTable.deletedAt)))
    .returning();

  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  await auditEntity.deleted("vehicle", vehicle.id, actor, vehicle, vehicle.licensePlate);

  // Cascade the soft-delete to the vehicle's children so nothing is left "live"
  // pointing at a hidden parent and a later cascade restore brings the whole
  // tree back. Only rows not already trashed are touched (isNull(deletedAt)),
  // so a child deleted separately earlier keeps its own deletedBy/deleteReason.
  await cascadeSoftDeleteVehicleChildren(vehicle.id, actor, reason, vehicle.deletedAt ?? new Date());

  res.sendStatus(204);
});

// Soft-delete a vehicle's work orders, service records, appointments and loaners
// with the same actor/reason/timestamp, auditing each cascaded delete. Mirrors
// the trash router's child-link map (loaners attach via either fleet or customer
// vehicle) so delete + cascade-restore stay symmetric.
async function cascadeSoftDeleteVehicleChildren(
  vehicleId: number,
  actor: AuditActor,
  reason: string | null,
  deletedAt: Date,
): Promise<void> {
  const set = { deletedAt, deletedBy: actor, deleteReason: reason };

  const workOrders = await db
    .update(workOrdersTable)
    .set(set)
    .where(and(eq(workOrdersTable.vehicleId, vehicleId), isNull(workOrdersTable.deletedAt)))
    .returning();
  for (const row of workOrders) {
    await auditEntity.deleted("work_order", row.id, actor, row);
    // Reuse the work-order child cascade so each cascaded order's photos (and
    // any loaner linked via workOrderId) are hidden too — otherwise the photo
    // subtree stays "live" pointing at a hidden work order and a later cascade
    // restore can't bring it back.
    await cascadeSoftDeleteWorkOrderChildren(row.id, actor, reason, deletedAt);
  }

  const serviceRecords = await db
    .update(serviceRecordsTable)
    .set(set)
    .where(and(eq(serviceRecordsTable.vehicleId, vehicleId), isNull(serviceRecordsTable.deletedAt)))
    .returning();
  for (const row of serviceRecords) {
    await auditEntity.deleted("service_record", row.id, actor, row);
  }

  const appointments = await db
    .update(appointmentsTable)
    .set(set)
    .where(and(eq(appointmentsTable.vehicleId, vehicleId), isNull(appointmentsTable.deletedAt)))
    .returning();
  for (const row of appointments) {
    await auditEntity.deleted("appointment", row.id, actor, row);
  }

  const loaners = await db
    .update(loanersTable)
    .set(set)
    .where(
      and(
        or(eq(loanersTable.fleetVehicleId, vehicleId), eq(loanersTable.customerVehicleId, vehicleId)),
        isNull(loanersTable.deletedAt),
      ),
    )
    .returning();
  for (const row of loaners) {
    await auditEntity.deleted("loaner", row.id, actor, row);
  }
}

export default router;
