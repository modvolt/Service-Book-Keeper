import { Router, type IRouter } from "express";
import { eq, and, gte, lte, asc, desc, ne, isNull, or, ilike } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, loanersTable, vehiclesTable } from "@workspace/db";
import {
  ListLoanersQueryParams,
  CreateLoanerBody,
  CheckLoanerOverlapQueryParams,
  ListLoanerCustomerSuggestionsQueryParams,
  UpdateLoanerParams,
  UpdateLoanerBody,
  DeleteLoanerParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const fleetVehicle = alias(vehiclesTable, "fleet_vehicle");
const customerVehicle = alias(vehiclesTable, "customer_vehicle");

const selectShape = {
  id: loanersTable.id,
  fleetVehicleId: loanersTable.fleetVehicleId,
  workOrderId: loanersTable.workOrderId,
  customerVehicleId: loanersTable.customerVehicleId,
  customerName: loanersTable.customerName,
  customerPhone: loanersTable.customerPhone,
  startDate: loanersTable.startDate,
  endDate: loanersTable.endDate,
  manualEndDate: loanersTable.manualEndDate,
  status: loanersTable.status,
  note: loanersTable.note,
  createdAt: loanersTable.createdAt,
  fleetLicensePlate: fleetVehicle.licensePlate,
  fleetMake: fleetVehicle.make,
  fleetModel: fleetVehicle.model,
  customerLicensePlate: customerVehicle.licensePlate,
};

function baseQuery() {
  return db
    .select(selectShape)
    .from(loanersTable)
    .leftJoin(fleetVehicle, eq(loanersTable.fleetVehicleId, fleetVehicle.id))
    .leftJoin(customerVehicle, eq(loanersTable.customerVehicleId, customerVehicle.id));
}

router.get("/loaners", async (req, res): Promise<void> => {
  const q = ListLoanersQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const conds = [];
  if (q.data.fleetVehicleId != null) conds.push(eq(loanersTable.fleetVehicleId, q.data.fleetVehicleId));
  if (q.data.workOrderId != null) conds.push(eq(loanersTable.workOrderId, q.data.workOrderId));
  if (q.data.status) conds.push(eq(loanersTable.status, q.data.status));
  // Date-range overlap: a loan overlaps [from,to] when it starts on/before `to`
  // and ends on/after `from` (an open-ended loan has no end so it always
  // extends to the future).
  if (q.data.to) conds.push(lte(loanersTable.startDate, q.data.to));
  if (q.data.from) conds.push(or(isNull(loanersTable.endDate), gte(loanersTable.endDate, q.data.from)));

  let rows = await baseQuery()
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(loanersTable.startDate), desc(loanersTable.id));

  if (q.data.search) {
    const s = q.data.search.toLowerCase();
    rows = rows.filter((r) =>
      r.customerName?.toLowerCase().includes(s) ||
      r.customerPhone?.toLowerCase().includes(s) ||
      r.fleetLicensePlate?.toLowerCase().includes(s) ||
      r.fleetMake?.toLowerCase().includes(s) ||
      r.fleetModel?.toLowerCase().includes(s) ||
      r.customerLicensePlate?.toLowerCase().includes(s) ||
      r.note?.toLowerCase().includes(s)
    );
  }

  res.json(rows);
});

// Soft, non-blocking overlap check: returns active loans of the same fleet
// vehicle whose date range intersects the requested window.
router.get("/loaners/check-overlap", async (req, res): Promise<void> => {
  const q = CheckLoanerOverlapQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const end = q.data.endDate ?? null;
  const conds = [
    eq(loanersTable.fleetVehicleId, q.data.fleetVehicleId),
    eq(loanersTable.status, "active"),
    // existing.startDate <= requested end (open requested end = no upper bound)
    ...(end ? [lte(loanersTable.startDate, end)] : []),
    // existing.endDate >= requested start (open existing end = no upper bound)
    or(isNull(loanersTable.endDate), gte(loanersTable.endDate, q.data.startDate)),
  ];
  if (q.data.excludeId != null) conds.push(ne(loanersTable.id, q.data.excludeId));

  const rows = await baseQuery().where(and(...conds)).orderBy(asc(loanersTable.startDate));
  res.json(rows);
});

// Suggest known customers (vehicle owners) when assigning a loaner borrower.
// Matches by owner name, owner phone, or license plate (case-insensitive).
router.get("/loaners/customer-suggestions", async (req, res): Promise<void> => {
  const q = ListLoanerCustomerSuggestionsQueryParams.safeParse(req.query);
  if (!q.success) { res.status(400).json({ error: q.error.message }); return; }

  const term = q.data.search.trim();
  if (term.length < 2) { res.json([]); return; }
  const like = `%${term}%`;

  const rows = await db
    .select({
      vehicleId: vehiclesTable.id,
      licensePlate: vehiclesTable.licensePlate,
      ownerName: vehiclesTable.ownerName,
      ownerPhone: vehiclesTable.ownerPhone,
      make: vehiclesTable.make,
      model: vehiclesTable.model,
    })
    .from(vehiclesTable)
    .where(
      and(
        eq(vehiclesTable.isFleet, false),
        or(
          ilike(vehiclesTable.ownerName, like),
          ilike(vehiclesTable.ownerPhone, like),
          ilike(vehiclesTable.licensePlate, like),
        ),
      ),
    )
    .orderBy(asc(vehiclesTable.ownerName), asc(vehiclesTable.licensePlate))
    .limit(10);

  res.json(rows);
});

async function loadEnriched(id: number) {
  const [row] = await baseQuery().where(eq(loanersTable.id, id));
  return row ?? null;
}

router.post("/loaners", async (req, res): Promise<void> => {
  const parsed = CreateLoanerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  // Validate the fleet vehicle exists and is actually a fleet vehicle.
  const [fleet] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, parsed.data.fleetVehicleId));
  if (!fleet) { res.status(400).json({ error: "Vozidlo z vozového parku nenalezeno" }); return; }
  if (!fleet.isFleet) { res.status(400).json({ error: "Zvolené vozidlo není ve vozovém parku" }); return; }

  const insertData: typeof loanersTable.$inferInsert = {
    fleetVehicleId: parsed.data.fleetVehicleId,
    workOrderId: parsed.data.workOrderId ?? null,
    customerVehicleId: parsed.data.customerVehicleId ?? null,
    customerName: parsed.data.customerName ?? null,
    customerPhone: parsed.data.customerPhone ?? null,
    startDate: parsed.data.startDate,
    endDate: parsed.data.endDate ?? null,
    manualEndDate: parsed.data.manualEndDate ?? false,
  };
  if (parsed.data.status) insertData.status = parsed.data.status;

  const [row] = await db.insert(loanersTable).values(insertData).returning();
  const enriched = await loadEnriched(row.id);
  res.status(201).json(enriched);
});

router.patch("/loaners/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = UpdateLoanerParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  const parsed = UpdateLoanerBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.message }); return; }

  const data: Partial<typeof loanersTable.$inferInsert> = {};
  if (parsed.data.fleetVehicleId != null) data.fleetVehicleId = parsed.data.fleetVehicleId;
  if (parsed.data.workOrderId !== undefined) data.workOrderId = parsed.data.workOrderId;
  if (parsed.data.customerVehicleId !== undefined) data.customerVehicleId = parsed.data.customerVehicleId;
  if (parsed.data.customerName !== undefined) data.customerName = parsed.data.customerName;
  if (parsed.data.customerPhone !== undefined) data.customerPhone = parsed.data.customerPhone;
  if (parsed.data.startDate) data.startDate = parsed.data.startDate;
  // A return date set through this endpoint counts as a manual override unless
  // the caller explicitly says otherwise.
  if (parsed.data.endDate !== undefined) {
    data.endDate = parsed.data.endDate;
    data.manualEndDate = parsed.data.manualEndDate ?? (parsed.data.endDate != null);
  } else if (parsed.data.manualEndDate != null) {
    data.manualEndDate = parsed.data.manualEndDate;
  }
  if (parsed.data.status) data.status = parsed.data.status;

  const [row] = await db.update(loanersTable).set(data)
    .where(eq(loanersTable.id, params.data.id)).returning();
  if (!row) { res.status(404).json({ error: "Zápůjčka nenalezena" }); return; }

  const enriched = await loadEnriched(row.id);
  res.json(enriched);
});

router.delete("/loaners/:id", async (req, res): Promise<void> => {
  const raw = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const id = parseInt(raw, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

  const params = DeleteLoanerParams.safeParse({ id });
  if (!params.success) { res.status(400).json({ error: params.error.message }); return; }

  await db.delete(loanersTable).where(eq(loanersTable.id, params.data.id));
  res.status(204).end();
});

export default router;
