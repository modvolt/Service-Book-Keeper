import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import {
  db,
  vehiclesTable,
  serviceRecordsTable,
  workOrdersTable,
  appointmentsTable,
  photosTable,
  auditLogTable,
  customerReminderLogTable,
  loanersTable,
  consentHistoryTable,
} from "@workspace/db";
import { SetVehicleConsentBody } from "@workspace/api-zod";
import { getObjectStorageService } from "../lib/storage";
import { audit } from "../lib/audit";
import { getActor } from "../lib/actor";

const router: IRouter = Router();
const storage = getObjectStorageService();

// Legal bases for processing personal data (GDPR Art. 6) offered by the app.
const LEGAL_BASES = ["contract", "legitimate_interest", "consent"] as const;
type LegalBasis = (typeof LEGAL_BASES)[number];

function normalizeLegalBasis(raw: unknown): LegalBasis | null {
  return typeof raw === "string" && (LEGAL_BASES as readonly string[]).includes(raw)
    ? (raw as LegalBasis)
    : null;
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function escapeHtml(value: unknown): string {
  if (value == null) return "";
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function countFor(
  table: typeof serviceRecordsTable | typeof workOrdersTable | typeof appointmentsTable,
  vehicleId: number,
): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(table)
    .where(eq(table.vehicleId, vehicleId));
  return row?.c ?? 0;
}

// Loaners linked to this vehicle as the borrowing customer.
async function loanerCountFor(vehicleId: number): Promise<number> {
  const [row] = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(loanersTable)
    .where(eq(loanersTable.customerVehicleId, vehicleId));
  return row?.c ?? 0;
}

// Resolve a `{ c }` count query (count(*)::int) to a plain number.
async function countRows(query: PromiseLike<{ c: number }[]>): Promise<number> {
  const [row] = await query;
  return row?.c ?? 0;
}

// GET /gdpr/search?q= — find vehicles holding personal data matching the query.
router.get("/gdpr/search", async (req, res): Promise<void> => {
  const q = (req.query.q ?? "").toString().trim();
  if (!q) {
    res.json({ vehicles: [] });
    return;
  }
  const pattern = `%${q}%`;

  // Vehicles whose linked appointments match the customer's name/phone.
  const apptRows = await db
    .select({ vid: appointmentsTable.vehicleId })
    .from(appointmentsTable)
    .where(
      and(
        isNotNull(appointmentsTable.vehicleId),
        or(
          ilike(appointmentsTable.customerName, pattern),
          ilike(appointmentsTable.customerPhone, pattern),
        ),
      ),
    );
  const apptVehicleIds = Array.from(
    new Set(apptRows.map((r) => r.vid).filter((v): v is number => v != null)),
  );

  // Vehicles linked (as the borrowing customer) to loaners whose free-text
  // customer name/phone matches the query.
  const loanerRows = await db
    .select({ vid: loanersTable.customerVehicleId })
    .from(loanersTable)
    .where(
      and(
        isNotNull(loanersTable.customerVehicleId),
        or(
          ilike(loanersTable.customerName, pattern),
          ilike(loanersTable.customerPhone, pattern),
        ),
      ),
    );
  const loanerVehicleIds = Array.from(
    new Set(loanerRows.map((r) => r.vid).filter((v): v is number => v != null)),
  );

  const conditions = [
    ilike(vehiclesTable.licensePlate, pattern),
    ilike(vehiclesTable.ownerName, pattern),
    ilike(vehiclesTable.ownerAddress, pattern),
    ilike(vehiclesTable.ownerPhone, pattern),
    ilike(vehiclesTable.ownerEmail, pattern),
    ilike(vehiclesTable.ownerIco, pattern),
    ilike(vehiclesTable.ownerDic, pattern),
  ];
  if (apptVehicleIds.length > 0) {
    conditions.push(inArray(vehiclesTable.id, apptVehicleIds));
  }
  if (loanerVehicleIds.length > 0) {
    conditions.push(inArray(vehiclesTable.id, loanerVehicleIds));
  }

  const rows = await db
    .select()
    .from(vehiclesTable)
    .where(or(...conditions))
    .orderBy(vehiclesTable.licensePlate);

  const vehicles = await Promise.all(
    rows.map(async (v) => ({
      id: v.id,
      licensePlate: v.licensePlate,
      ownerType: v.ownerType,
      ownerName: v.ownerName,
      ownerPhone: v.ownerPhone,
      ownerEmail: v.ownerEmail,
      legalBasis: v.legalBasis,
      consentGivenAt: v.consentGivenAt ? v.consentGivenAt.toISOString() : null,
      serviceRecordCount: await countFor(serviceRecordsTable, v.id),
      workOrderCount: await countFor(workOrdersTable, v.id),
      appointmentCount: await countFor(appointmentsTable, v.id),
      loanerCount: await loanerCountFor(v.id),
    })),
  );

  res.json({ vehicles });
});

// GET /gdpr/export/:vehicleId — full data export for a data-subject access request.
router.get("/gdpr/export/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [serviceRecords, workOrders, appointments, loaners, consentHistory] = await Promise.all([
    db.select().from(serviceRecordsTable).where(eq(serviceRecordsTable.vehicleId, id)),
    db.select().from(workOrdersTable).where(eq(workOrdersTable.vehicleId, id)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.vehicleId, id)),
    db.select().from(loanersTable).where(eq(loanersTable.customerVehicleId, id)),
    db
      .select()
      .from(consentHistoryTable)
      .where(eq(consentHistoryTable.vehicleId, id))
      .orderBy(desc(consentHistoryTable.createdAt)),
  ]);

  await audit("gdpr_export", {
    entity: "vehicle",
    entityId: id,
    detail: `Export dat vozidla ${vehicle.licensePlate}`,
    actor: getActor(req),
  });

  res.json({
    exportedAt: new Date().toISOString(),
    vehicle,
    serviceRecords,
    workOrders,
    appointments,
    loaners,
    consentHistory,
  });
});

// GET /gdpr/export/:vehicleId/report — human-readable (HTML) data export for a
// data-subject access request. Served as a standalone printable document so the
// owner can read it directly or print/save it as PDF from the browser.
router.get("/gdpr/export/:vehicleId/report", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [serviceRecords, workOrders, appointments, loaners, consentHistory] = await Promise.all([
    db.select().from(serviceRecordsTable).where(eq(serviceRecordsTable.vehicleId, id)),
    db.select().from(workOrdersTable).where(eq(workOrdersTable.vehicleId, id)),
    db.select().from(appointmentsTable).where(eq(appointmentsTable.vehicleId, id)),
    db.select().from(loanersTable).where(eq(loanersTable.customerVehicleId, id)),
    db
      .select()
      .from(consentHistoryTable)
      .where(eq(consentHistoryTable.vehicleId, id))
      .orderBy(desc(consentHistoryTable.createdAt)),
  ]);

  await audit("gdpr_export", {
    entity: "vehicle",
    entityId: id,
    detail: `Čitelný export dat vozidla ${vehicle.licensePlate}`,
    actor: getActor(req),
  });

  const html = renderExportReport({
    vehicle,
    serviceRecords,
    workOrders,
    appointments,
    loaners,
    consentHistory,
  });
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="gdpr-export-${vehicle.licensePlate.replace(/\s+/g, "")}.html"`,
  );
  res.send(html);
});

// POST /gdpr/anonymize/:vehicleId — strip personal data, keep technical history.
router.post("/gdpr/anonymize/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  await db.transaction(async (tx) => {
    await tx
      .update(vehiclesTable)
      .set({
        ownerType: "private",
        ownerName: null,
        ownerAddress: null,
        ownerIco: null,
        ownerDic: null,
        ownerPhone: null,
        ownerEmail: null,
        legalBasis: null,
        consentGivenAt: null,
        consentNote: null,
      })
      .where(eq(vehiclesTable.id, id));

    await tx
      .update(appointmentsTable)
      .set({ customerName: null, customerPhone: null })
      .where(eq(appointmentsTable.vehicleId, id));

    // Strip the borrower's free-text PII from loaners but keep the technical
    // lending record (which fleet vehicle, dates).
    await tx
      .update(loanersTable)
      .set({ customerName: null, customerPhone: null })
      .where(eq(loanersTable.customerVehicleId, id));

    // Drop the customer-reminder ledger so a future re-consent starts clean.
    await tx
      .delete(customerReminderLogTable)
      .where(eq(customerReminderLogTable.vehicleId, id));

    // Record the basis/consent withdrawal in history (no PII — just the event).
    if (vehicle.legalBasis != null || vehicle.consentGivenAt != null) {
      await tx.insert(consentHistoryTable).values({
        vehicleId: id,
        basis: null,
        event: "withdrawn",
        note: null,
        actor: getActor(req),
      });
    }
  });

  await audit("gdpr_anonymize", {
    entity: "vehicle",
    entityId: id,
    detail: `Anonymizace osobních údajů vozidla ${vehicle.licensePlate}`,
    actor: getActor(req),
  });

  res.json({ success: true, message: "Osobní údaje byly anonymizovány." });
});

// DELETE /gdpr/vehicle/:vehicleId — permanently erase the vehicle and all linked data.
router.delete("/gdpr/vehicle/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  // Work orders for this vehicle (vehicleId is set-null, so delete explicitly).
  const workOrders = await db
    .select({ id: workOrdersTable.id })
    .from(workOrdersTable)
    .where(eq(workOrdersTable.vehicleId, id));
  const workOrderIds = workOrders.map((w) => w.id);

  // Erase the underlying photo blobs from object storage FIRST. If any blob
  // fails to delete we must not claim a complete erasure, so we abort before
  // touching the DB. deleteObject is idempotent, so a retry is safe.
  if (workOrderIds.length > 0) {
    const photos = await db
      .select({ url: photosTable.url })
      .from(photosTable)
      .where(inArray(photosTable.workOrderId, workOrderIds));
    const results = await Promise.allSettled(photos.map((p) => storage.deleteObject(p.url)));
    const failed = results.filter((r) => r.status === "rejected");
    if (failed.length > 0) {
      req.log.error(
        { vehicleId: id, failed: failed.length },
        "GDPR erasure aborted: failed to delete photo blobs from storage",
      );
      res.status(500).json({
        error: "Smazání fotografií z úložiště selhalo. Data nebyla smazána, zkuste to znovu.",
      });
      return;
    }
  }

  // Tally what is being erased BEFORE deletion so the audit snapshot can prove
  // the scope of erasure. Counts only — no names, phones, or other PII.
  const [
    photoCount,
    appointmentCount,
    loanerCount,
    serviceRecordCount,
    consentHistoryCount,
  ] = await Promise.all([
    workOrderIds.length > 0
      ? countRows(db.select({ c: sql<number>`count(*)::int` }).from(photosTable).where(inArray(photosTable.workOrderId, workOrderIds)))
      : Promise.resolve(0),
    countRows(db.select({ c: sql<number>`count(*)::int` }).from(appointmentsTable).where(eq(appointmentsTable.vehicleId, id))),
    countRows(db.select({ c: sql<number>`count(*)::int` }).from(loanersTable).where(eq(loanersTable.customerVehicleId, id))),
    countRows(db.select({ c: sql<number>`count(*)::int` }).from(serviceRecordsTable).where(eq(serviceRecordsTable.vehicleId, id))),
    countRows(db.select({ c: sql<number>`count(*)::int` }).from(consentHistoryTable).where(eq(consentHistoryTable.vehicleId, id))),
  ]);

  await db.transaction(async (tx) => {
    if (workOrderIds.length > 0) {
      // Removing work orders cascades the photo rows.
      await tx.delete(workOrdersTable).where(inArray(workOrdersTable.id, workOrderIds));
    }
    // Appointments use set-null on vehicle delete, so remove them explicitly.
    await tx.delete(appointmentsTable).where(eq(appointmentsTable.vehicleId, id));
    // Loaners reference the customer vehicle with set-null, so remove the
    // borrower's lending records explicitly. (Fleet-vehicle loaners cascade.)
    await tx.delete(loanersTable).where(eq(loanersTable.customerVehicleId, id));
    // consent_history cascades with the vehicle, but delete explicitly so the
    // erasure is complete even if the FK rule changes.
    await tx.delete(consentHistoryTable).where(eq(consentHistoryTable.vehicleId, id));
    // service_records cascade with the vehicle.
    await tx.delete(vehiclesTable).where(eq(vehiclesTable.id, id));
  });

  // Sanitized erasure record: license plate (not personal data on its own) plus
  // counts of the removed rows. Deliberately excludes owner name/phone/email and
  // any free-text so the audit trail itself never re-introduces erased PII.
  await audit("gdpr_delete", {
    entity: "vehicle",
    entityId: id,
    detail: `Trvalé smazání vozidla ${vehicle.licensePlate} a všech souvisejících dat`,
    actor: getActor(req),
    snapshot: {
      licensePlate: vehicle.licensePlate,
      erasedAt: new Date().toISOString(),
      counts: {
        workOrders: workOrderIds.length,
        photos: photoCount,
        appointments: appointmentCount,
        loaners: loanerCount,
        serviceRecords: serviceRecordCount,
        consentHistory: consentHistoryCount,
      },
    },
  });

  res.json({ success: true, message: "Vozidlo a všechna související data byla smazána." });
});

// PUT /gdpr/consent/:vehicleId — record or withdraw the owner's processing consent.
router.put("/gdpr/consent/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const parsed = SetVehicleConsentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }

  // Resolve the legal basis. When consent is being granted and no explicit basis
  // is supplied, default to "consent"; when withdrawn, clear it.
  const requestedBasis = normalizeLegalBasis(parsed.data.legalBasis);
  const nextBasis = parsed.data.given ? (requestedBasis ?? "consent") : null;
  // Capture the prior state BEFORE the update — classify the history event now
  // so it never depends on read-after-write ordering. A revoke is always
  // "withdrawn"; a fresh grant (no prior legal basis on record) is "granted";
  // changing an already-recorded basis is "updated"; re-affirming the same
  // basis is "granted".
  const priorBasis = vehicle.legalBasis ?? null;
  const basisChanged = priorBasis !== nextBasis;
  const event = !parsed.data.given
    ? "withdrawn"
    : priorBasis !== null && basisChanged
      ? "updated"
      : "granted";

  const [updated] = await db
    .update(vehiclesTable)
    .set({
      legalBasis: nextBasis,
      consentGivenAt: parsed.data.given ? new Date() : null,
      consentNote: parsed.data.note ?? null,
    })
    .where(eq(vehiclesTable.id, id))
    .returning();

  // Append an immutable history row for this change.
  await db.insert(consentHistoryTable).values({
    vehicleId: id,
    basis: nextBasis,
    event,
    note: parsed.data.note ?? null,
    actor: getActor(req),
  });

  await audit("gdpr_consent", {
    entity: "vehicle",
    entityId: id,
    detail: `${parsed.data.given ? "Udělen" : "Odvolán"} souhlas se zpracováním pro vozidlo ${vehicle.licensePlate}`,
    actor: getActor(req),
  });

  res.json(updated);
});

// GET /gdpr/consent-history/:vehicleId — full consent/legal-basis change log.
router.get("/gdpr/consent-history/:vehicleId", async (req, res): Promise<void> => {
  const id = parseId(req.params.vehicleId);
  if (id == null) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const [vehicle] = await db.select().from(vehiclesTable).where(eq(vehiclesTable.id, id));
  if (!vehicle) {
    res.status(404).json({ error: "Vozidlo nenalezeno" });
    return;
  }
  const rows = await db
    .select()
    .from(consentHistoryTable)
    .where(eq(consentHistoryTable.vehicleId, id))
    .orderBy(desc(consentHistoryTable.createdAt));
  res.json(rows);
});

// GET /gdpr/retention?years= — surface records older than the retention
// threshold (work orders, photos, contacts) as cleanup candidates. This only
// REPORTS candidates; it never deletes anything (enforcement is out of scope).
router.get("/gdpr/retention", async (req, res): Promise<void> => {
  const rawYears = Number(req.query.years);
  const years = Number.isInteger(rawYears) && rawYears > 0 ? Math.min(rawYears, 50) : 3;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);

  // Aged work orders: completed (or created, if never completed) before cutoff.
  const workOrderRows = await db
    .select({
      id: workOrdersTable.id,
      status: workOrdersTable.status,
      createdAt: workOrdersTable.createdAt,
      completedAt: workOrdersTable.completedAt,
      vehicleId: workOrdersTable.vehicleId,
      licensePlate: vehiclesTable.licensePlate,
    })
    .from(workOrdersTable)
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .where(lt(sql`coalesce(${workOrdersTable.completedAt}, ${workOrdersTable.createdAt})`, cutoff))
    .orderBy(workOrdersTable.createdAt);

  // Aged photos: uploaded before the cutoff. License plate resolved via the
  // owning work order's vehicle.
  const photoRows = await db
    .select({
      id: photosTable.id,
      createdAt: photosTable.createdAt,
      vehicleId: vehiclesTable.id,
      licensePlate: vehiclesTable.licensePlate,
    })
    .from(photosTable)
    .leftJoin(workOrdersTable, eq(photosTable.workOrderId, workOrdersTable.id))
    .leftJoin(vehiclesTable, eq(workOrdersTable.vehicleId, vehiclesTable.id))
    .where(lt(photosTable.createdAt, cutoff))
    .orderBy(photosTable.createdAt);

  // Aged contacts: vehicles still holding owner PII whose record predates the
  // cutoff (a proxy for "no recent relationship").
  const contactRows = await db
    .select({
      id: vehiclesTable.id,
      licensePlate: vehiclesTable.licensePlate,
      ownerType: vehiclesTable.ownerType,
      consentGivenAt: vehiclesTable.consentGivenAt,
      createdAt: vehiclesTable.createdAt,
    })
    .from(vehiclesTable)
    .where(
      and(
        or(
          isNotNull(vehiclesTable.ownerName),
          isNotNull(vehiclesTable.ownerPhone),
          isNotNull(vehiclesTable.ownerEmail),
        ),
        lt(vehiclesTable.createdAt, cutoff),
      ),
    )
    .orderBy(vehiclesTable.createdAt);

  res.json({
    thresholdYears: years,
    generatedAt: new Date().toISOString(),
    workOrders: {
      count: workOrderRows.length,
      items: workOrderRows.map((w) => ({
        vehicleId: w.vehicleId,
        licensePlate: w.licensePlate,
        label: `Zakázka #${w.id}`,
        date: (w.completedAt ?? w.createdAt)?.toISOString() ?? null,
        detail: w.status,
      })),
    },
    photos: {
      count: photoRows.length,
      items: photoRows.map((p) => ({
        vehicleId: p.vehicleId,
        licensePlate: p.licensePlate,
        label: `Fotografie #${p.id}`,
        date: p.createdAt?.toISOString() ?? null,
        detail: null,
      })),
    },
    contacts: {
      count: contactRows.length,
      items: contactRows.map((c) => ({
        vehicleId: c.id,
        licensePlate: c.licensePlate,
        label: c.licensePlate,
        date: (c.consentGivenAt ?? c.createdAt)?.toISOString() ?? null,
        detail: c.ownerType,
      })),
    },
  });
});

// GET /gdpr/audit-log — recent audit entries, most recent first.
router.get("/gdpr/audit-log", async (req, res): Promise<void> => {
  const rawLimit = Number(req.query.limit);
  const limit = Number.isInteger(rawLimit) ? Math.min(Math.max(rawLimit, 1), 500) : 100;
  const rows = await db
    .select()
    .from(auditLogTable)
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);
  res.json(rows);
});

type VehicleRow = typeof vehiclesTable.$inferSelect;
type ServiceRecordRow = typeof serviceRecordsTable.$inferSelect;
type WorkOrderRow = typeof workOrdersTable.$inferSelect;
type AppointmentRow = typeof appointmentsTable.$inferSelect;
type LoanerRow = typeof loanersTable.$inferSelect;
type ConsentHistoryRow = typeof consentHistoryTable.$inferSelect;

const LEGAL_BASIS_LABELS: Record<string, string> = {
  contract: "Plnění smlouvy",
  legitimate_interest: "Oprávněný zájem",
  consent: "Souhlas",
};

const CONSENT_EVENT_LABELS: Record<string, string> = {
  granted: "Udělen souhlas",
  withdrawn: "Odvolán souhlas",
  updated: "Změna právního základu",
  migrated: "Převzato z historie",
};

function fmtDateTime(value: Date | string | null | undefined): string {
  if (value == null) return "—";
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("cs-CZ");
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return escapeHtml(value);
  return d.toLocaleDateString("cs-CZ");
}

function reportRow(label: string, value: unknown): string {
  const v = value == null || value === "" ? "—" : escapeHtml(value);
  return `<tr><th>${escapeHtml(label)}</th><td>${v}</td></tr>`;
}

// Build a self-contained, printable Czech HTML document summarizing all personal
// and technical data held for one vehicle (data-subject access request output).
function renderExportReport(data: {
  vehicle: VehicleRow;
  serviceRecords: ServiceRecordRow[];
  workOrders: WorkOrderRow[];
  appointments: AppointmentRow[];
  loaners: LoanerRow[];
  consentHistory: ConsentHistoryRow[];
}): string {
  const { vehicle, serviceRecords, workOrders, appointments, loaners, consentHistory } = data;

  const vehicleInfo = `
    <table class="kv">
      ${reportRow("SPZ", vehicle.licensePlate)}
      ${reportRow("Značka", vehicle.make)}
      ${reportRow("Model", vehicle.model)}
      ${reportRow("Rok", vehicle.year)}
      ${reportRow("VIN", vehicle.vin)}
      ${reportRow("Barva", vehicle.color)}
      ${reportRow("Stav km", vehicle.currentKm)}
    </table>`;

  const ownerInfo = `
    <table class="kv">
      ${reportRow("Typ", vehicle.ownerType === "company" ? "Firma" : "Soukromá osoba")}
      ${reportRow("Jméno / název", vehicle.ownerName)}
      ${reportRow("Adresa", vehicle.ownerAddress)}
      ${reportRow("IČO", vehicle.ownerIco)}
      ${reportRow("DIČ", vehicle.ownerDic)}
      ${reportRow("Telefon", vehicle.ownerPhone)}
      ${reportRow("E-mail", vehicle.ownerEmail)}
      ${reportRow("Právní základ", vehicle.legalBasis ? (LEGAL_BASIS_LABELS[vehicle.legalBasis] ?? vehicle.legalBasis) : null)}
      ${reportRow("Souhlas udělen", vehicle.consentGivenAt ? fmtDateTime(vehicle.consentGivenAt) : null)}
      ${reportRow("Poznámka k souhlasu", vehicle.consentNote)}
    </table>`;

  const consentSection =
    consentHistory.length > 0
      ? `<table class="list">
          <thead><tr><th>Datum</th><th>Událost</th><th>Právní základ</th><th>Poznámka</th></tr></thead>
          <tbody>${consentHistory
            .map(
              (c) =>
                `<tr><td>${fmtDateTime(c.createdAt)}</td><td>${escapeHtml(CONSENT_EVENT_LABELS[c.event] ?? c.event)}</td><td>${escapeHtml(c.basis ? (LEGAL_BASIS_LABELS[c.basis] ?? c.basis) : "—")}</td><td>${escapeHtml(c.note ?? "—")}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
      : `<p class="empty">Žádné záznamy o souhlasu.</p>`;

  const serviceSection =
    serviceRecords.length > 0
      ? `<table class="list">
          <thead><tr><th>Datum</th><th>Km</th><th>Popis</th><th>Technik</th></tr></thead>
          <tbody>${serviceRecords
            .map(
              (s) =>
                `<tr><td>${fmtDate(s.date)}</td><td>${escapeHtml(s.km ?? "—")}</td><td>${escapeHtml(s.description ?? s.otherWork ?? "—")}</td><td>${escapeHtml(s.technician ?? "—")}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
      : `<p class="empty">Žádné servisní záznamy.</p>`;

  const workOrderSection =
    workOrders.length > 0
      ? `<table class="list">
          <thead><tr><th>#</th><th>Vytvořeno</th><th>Dokončeno</th><th>Stav</th></tr></thead>
          <tbody>${workOrders
            .map(
              (w) =>
                `<tr><td>${w.id}</td><td>${fmtDateTime(w.createdAt)}</td><td>${w.completedAt ? fmtDateTime(w.completedAt) : "—"}</td><td>${escapeHtml(w.status)}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
      : `<p class="empty">Žádné zakázky.</p>`;

  const appointmentSection =
    appointments.length > 0
      ? `<table class="list">
          <thead><tr><th>Datum</th><th>Čas</th><th>Popis</th><th>Stav</th></tr></thead>
          <tbody>${appointments
            .map(
              (a) =>
                `<tr><td>${fmtDate(a.scheduledDate)}</td><td>${escapeHtml(a.scheduledTime ?? "—")}</td><td>${escapeHtml(a.description ?? "—")}</td><td>${escapeHtml(a.status)}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
      : `<p class="empty">Žádné objednávky.</p>`;

  const loanerSection =
    loaners.length > 0
      ? `<table class="list">
          <thead><tr><th>Od</th><th>Do</th><th>Stav</th><th>Poznámka</th></tr></thead>
          <tbody>${loaners
            .map(
              (l) =>
                `<tr><td>${fmtDate(l.startDate)}</td><td>${l.endDate ? fmtDate(l.endDate) : "—"}</td><td>${escapeHtml(l.status)}</td><td>${escapeHtml(l.note ?? "—")}</td></tr>`,
            )
            .join("")}</tbody>
        </table>`
      : `<p class="empty">Žádná zapůjčení.</p>`;

  return `<!DOCTYPE html>
<html lang="cs">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Export osobních údajů — ${escapeHtml(vehicle.licensePlate)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; max-width: 900px; margin: 0 auto; padding: 2rem; line-height: 1.5; }
  h1 { font-size: 1.5rem; margin-bottom: 0.25rem; }
  h2 { font-size: 1.1rem; margin-top: 2rem; border-bottom: 2px solid #e2e2e2; padding-bottom: 0.25rem; }
  .meta { color: #666; font-size: 0.85rem; margin-bottom: 1rem; }
  table { width: 100%; border-collapse: collapse; margin-top: 0.5rem; font-size: 0.9rem; }
  table.kv th { text-align: left; width: 220px; vertical-align: top; color: #555; font-weight: 600; padding: 0.25rem 0.5rem; }
  table.kv td { padding: 0.25rem 0.5rem; }
  table.list th, table.list td { border: 1px solid #ddd; padding: 0.4rem 0.5rem; text-align: left; }
  table.list thead th { background: #f5f5f5; }
  .empty { color: #888; font-style: italic; }
  @media print { body { padding: 0; } }
</style>
</head>
<body>
  <h1>Export osobních údajů</h1>
  <div class="meta">Vozidlo ${escapeHtml(vehicle.licensePlate)} · vygenerováno ${fmtDateTime(new Date())}</div>

  <h2>Vozidlo</h2>
  ${vehicleInfo}

  <h2>Provozovatel / vlastník</h2>
  ${ownerInfo}

  <h2>Historie souhlasu</h2>
  ${consentSection}

  <h2>Servisní záznamy</h2>
  ${serviceSection}

  <h2>Zakázky</h2>
  ${workOrderSection}

  <h2>Objednávky</h2>
  ${appointmentSection}

  <h2>Zapůjčení vozidel</h2>
  ${loanerSection}
</body>
</html>`;
}

export default router;
