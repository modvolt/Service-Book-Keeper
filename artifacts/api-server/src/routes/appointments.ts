import { Router, type IRouter } from "express";
import { eq, and, gte, lte, ilike, asc, isNull } from "drizzle-orm";
import { db, appointmentsTable, vehiclesTable } from "@workspace/db";
import { auditEntity } from "../lib/audit";
import { getActor } from "../lib/actor";
import {
  ListAppointmentsQueryParams,
  CreateAppointmentBody,
  UpdateAppointmentParams,
  UpdateAppointmentBody,
  DeleteAppointmentParams,
} from "@workspace/api-zod";
import { normalizeSpz } from "../lib/spz";

const router: IRouter = Router();

router.get("/appointments", async (req, res): Promise<void> => {
  const q = ListAppointmentsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const conds = [isNull(appointmentsTable.deletedAt)];
  if (q.data.from) conds.push(gte(appointmentsTable.scheduledDate, q.data.from));
  if (q.data.to) conds.push(lte(appointmentsTable.scheduledDate, q.data.to));

  const rows = await db.select().from(appointmentsTable)
    .where(and(...conds))
    .orderBy(asc(appointmentsTable.scheduledDate), asc(appointmentsTable.scheduledTime));

  res.json(rows);
});

router.post("/appointments", async (req, res): Promise<void> => {
  const parsed = CreateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  let vehicleId: number | null = null;
  let plate: string | null = null;
  if (parsed.data.licensePlate) {
    plate = normalizeSpz(parsed.data.licensePlate);
    const [v] = await db.select().from(vehiclesTable).where(and(ilike(vehiclesTable.licensePlate, plate), isNull(vehiclesTable.deletedAt)));
    vehicleId = v?.id ?? null;
  }

  const insertData: typeof appointmentsTable.$inferInsert = {
    scheduledDate: parsed.data.scheduledDate,
    scheduledTime: parsed.data.scheduledTime ?? null,
    licensePlate: plate,
    vehicleId,
    customerName: parsed.data.customerName ?? null,
    customerPhone: parsed.data.customerPhone ?? null,
    description: parsed.data.description ?? null,
    notes: parsed.data.notes ?? null,
  };
  if (parsed.data.status) insertData.status = parsed.data.status;

  const [row] = await db.insert(appointmentsTable).values(insertData).returning();
  await auditEntity.created("appointment", row.id, getActor(req), row, row.licensePlate ?? undefined);
  res.status(201).json(row);
});

router.patch("/appointments/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = UpdateAppointmentParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateAppointmentBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data: Partial<typeof appointmentsTable.$inferInsert> = {};
  if (parsed.data.scheduledDate) data.scheduledDate = parsed.data.scheduledDate;
  if (parsed.data.scheduledTime !== undefined) data.scheduledTime = parsed.data.scheduledTime;
  if (parsed.data.customerName !== undefined) data.customerName = parsed.data.customerName;
  if (parsed.data.customerPhone !== undefined) data.customerPhone = parsed.data.customerPhone;
  if (parsed.data.description !== undefined) data.description = parsed.data.description;
  if (parsed.data.notes !== undefined) data.notes = parsed.data.notes;
  if (parsed.data.status) data.status = parsed.data.status;
  if (parsed.data.licensePlate !== undefined) {
    if (parsed.data.licensePlate) {
      const plate = normalizeSpz(parsed.data.licensePlate);
      data.licensePlate = plate;
      const [v] = await db.select().from(vehiclesTable).where(and(ilike(vehiclesTable.licensePlate, plate), isNull(vehiclesTable.deletedAt)));
      data.vehicleId = v?.id ?? null;
    } else {
      data.licensePlate = null;
      data.vehicleId = null;
    }
  }
  const [existing] = await db.select().from(appointmentsTable)
    .where(and(eq(appointmentsTable.id, params.data.id), isNull(appointmentsTable.deletedAt)));
  if (!existing) { res.status(404).json({ error: "Rezervace nenalezena" }); return; }

  const [row] = await db.update(appointmentsTable).set(data)
    .where(eq(appointmentsTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Rezervace nenalezena" }); return; }

  await auditEntity.updated("appointment", row.id, getActor(req), existing, row.licensePlate ?? undefined);
  res.json(row);
});

router.delete("/appointments/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeleteAppointmentParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const reason = typeof req.body?.reason === "string" ? req.body.reason : null;
  const actor = getActor(req);
  const [row] = await db
    .update(appointmentsTable)
    .set({ deletedAt: new Date(), deletedBy: actor, deleteReason: reason })
    .where(and(eq(appointmentsTable.id, params.data.id), isNull(appointmentsTable.deletedAt)))
    .returning();
  if (!row) { res.status(404).json({ error: "Rezervace nenalezena" }); return; }
  await auditEntity.deleted("appointment", row.id, actor, row, row.licensePlate ?? undefined);
  res.status(204).end();
});

export default router;
