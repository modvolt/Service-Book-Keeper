import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";
import {
  db,
  vehiclesTable,
  workOrdersTable,
  serviceRecordsTable,
  materialsCatalogTable,
  loanersTable,
  appointmentsTable,
  photosTable,
} from "@workspace/db";
import { auditEntity, type AuditActor } from "../lib/audit";
import { getActor } from "../lib/actor";
import { getObjectStorageService } from "../lib/storage";

const router: IRouter = Router();
const storage = getObjectStorageService();

/** Minimal logger shape so both `req.log` (pino) and the singleton logger fit. */
type ErrorLogger = { error: (obj: unknown, msg?: string) => void };

export type TrashEntity =
  | "vehicle"
  | "work_order"
  | "service_record"
  | "material"
  | "loaner"
  | "appointment"
  | "photo";

interface TrashItem {
  entity: TrashEntity;
  id: number;
  label: string;
  deletedAt: string;
  deletedBy: string | null;
  deleteReason: string | null;
}

// A snapshot is the row captured before restore/purge, used for the audit trail.
type Snapshot = Record<string, unknown>;

// A child row points at one or more parents via FK columns. Restoring a child
// while its parent is still soft-deleted would orphan it (it would reappear
// attached to a hidden parent, inconsistent with every list that filters out
// deleted parents). Each link knows how to detect that and the Czech message to
// show when it blocks the restore.
interface ParentLink {
  // Czech message shown when this parent is still in the trash.
  blockedMessage: string;
  // True when the (trashed) child has a non-null FK pointing at a parent that
  // is itself still soft-deleted.
  parentTrashed: (childId: number) => Promise<boolean>;
}

interface EntityConfig {
  // Trashed rows for this entity, most recently deleted first.
  list: () => Promise<TrashItem[]>;
  // Parent links checked before a restore; if any parent is still trashed the
  // restore is blocked with that link's message. Omitted for top-level entities
  // (vehicle, material) that have no parent.
  parents?: ParentLink[];
  // Clears the soft-delete flags; returns the restored row or null if not found.
  restore: (id: number) => Promise<Snapshot | null>;
  // Hard-deletes the row (children cascade / set-null via FK); returns the
  // purged row or null if not found. Only removes DB rows — the route handler
  // deletes the associated storage blobs first via `photoUrls` (below).
  purge: (id: number) => Promise<Snapshot | null>;
  // Collects the `/objects/...` paths of photo blobs that this purge would
  // orphan, but only when the target is a trashed, purge-eligible row. The
  // handler deletes these blobs before the DB rows (GDPR erasure ordering:
  // abort on blob failure so we never claim a delete that left files behind).
  // Omitted for entities that own no photos. A vehicle purge set-nulls its
  // work orders (they survive), so it intentionally has no blobs to clean.
  photoUrls?: (id: number) => Promise<string[]>;
}

const CLEAR = { deletedAt: null, deletedBy: null, deleteReason: null };

// Minimal structural shapes so the factory accepts any soft-deletable table /
// FK column without dragging in drizzle's full column generics.
type ChildTable = PgTable & { id: PgColumn; deletedAt: PgColumn };
type ParentTable = PgTable & { id: PgColumn; deletedAt: PgColumn };

// Build a ParentLink: a trashed child with a non-null `fkColumn` whose target
// parent row is itself still soft-deleted blocks the restore. A null FK (no
// parent) or a live parent does not block. The child is filtered on
// `isNotNull(deletedAt)` so a non-trashed / missing child never blocks here —
// it falls through to the restore handler's own 404.
function parentLink(
  childTable: ChildTable,
  fkColumn: PgColumn,
  parentTable: ParentTable,
  blockedMessage: string,
): ParentLink {
  return {
    blockedMessage,
    parentTrashed: async (childId) => {
      const [child] = await db
        .select({ fk: fkColumn })
        .from(childTable)
        .where(and(eq(childTable.id, childId), isNotNull(childTable.deletedAt)));
      const fk = child?.fk;
      if (fk == null) return false;
      const [parent] = await db
        .select({ deletedAt: parentTable.deletedAt })
        .from(parentTable)
        .where(eq(parentTable.id, fk as number));
      return parent != null && parent.deletedAt != null;
    },
  };
}

const ENTITIES: Record<TrashEntity, EntityConfig> = {
  vehicle: {
    list: async () => {
      const rows = await db
        .select()
        .from(vehiclesTable)
        .where(isNotNull(vehiclesTable.deletedAt))
        .orderBy(desc(vehiclesTable.deletedAt));
      return rows.map((r) => toItem("vehicle", r.id, r.licensePlate || `#${r.id}`, r));
    },
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(vehiclesTable)
        .where(and(eq(vehiclesTable.id, id), isNotNull(vehiclesTable.deletedAt)));
      if (!existing) return null;
      await db.update(vehiclesTable).set(CLEAR).where(eq(vehiclesTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(vehiclesTable)
        .where(and(eq(vehiclesTable.id, id), isNotNull(vehiclesTable.deletedAt)));
      if (!existing) return null;
      await db.delete(vehiclesTable).where(eq(vehiclesTable.id, id));
      return existing;
    },
  },
  work_order: {
    list: async () => {
      const rows = await db
        .select()
        .from(workOrdersTable)
        .where(isNotNull(workOrdersTable.deletedAt))
        .orderBy(desc(workOrdersTable.deletedAt));
      return rows.map((r) => toItem("work_order", r.id, `${r.licensePlate || "?"} #${r.id}`, r));
    },
    parents: [
      parentLink(
        workOrdersTable,
        workOrdersTable.vehicleId,
        vehiclesTable,
        "Zakázku nelze obnovit: nadřazené vozidlo je v koši. Nejprve obnovte vozidlo.",
      ),
    ],
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(workOrdersTable)
        .where(and(eq(workOrdersTable.id, id), isNotNull(workOrdersTable.deletedAt)));
      if (!existing) return null;
      await db.update(workOrdersTable).set(CLEAR).where(eq(workOrdersTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(workOrdersTable)
        .where(and(eq(workOrdersTable.id, id), isNotNull(workOrdersTable.deletedAt)));
      if (!existing) return null;
      await db.delete(workOrdersTable).where(eq(workOrdersTable.id, id));
      return existing;
    },
    photoUrls: async (id) => {
      // Only a trashed, purge-eligible work order; otherwise we'd delete the
      // blobs of a live work order.
      const [existing] = await db
        .select({ id: workOrdersTable.id })
        .from(workOrdersTable)
        .where(and(eq(workOrdersTable.id, id), isNotNull(workOrdersTable.deletedAt)));
      if (!existing) return [];
      const rows = await db
        .select({ url: photosTable.url })
        .from(photosTable)
        .where(eq(photosTable.workOrderId, id));
      return rows.map((r) => r.url);
    },
  },
  service_record: {
    list: async () => {
      const rows = await db
        .select()
        .from(serviceRecordsTable)
        .where(isNotNull(serviceRecordsTable.deletedAt))
        .orderBy(desc(serviceRecordsTable.deletedAt));
      return rows.map((r) =>
        toItem("service_record", r.id, (r.description || `Záznam #${r.id}`).slice(0, 80), r),
      );
    },
    parents: [
      parentLink(
        serviceRecordsTable,
        serviceRecordsTable.vehicleId,
        vehiclesTable,
        "Servisní záznam nelze obnovit: nadřazené vozidlo je v koši. Nejprve obnovte vozidlo.",
      ),
    ],
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(serviceRecordsTable)
        .where(and(eq(serviceRecordsTable.id, id), isNotNull(serviceRecordsTable.deletedAt)));
      if (!existing) return null;
      await db.update(serviceRecordsTable).set(CLEAR).where(eq(serviceRecordsTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(serviceRecordsTable)
        .where(and(eq(serviceRecordsTable.id, id), isNotNull(serviceRecordsTable.deletedAt)));
      if (!existing) return null;
      await db.delete(serviceRecordsTable).where(eq(serviceRecordsTable.id, id));
      return existing;
    },
  },
  material: {
    list: async () => {
      const rows = await db
        .select()
        .from(materialsCatalogTable)
        .where(isNotNull(materialsCatalogTable.deletedAt))
        .orderBy(desc(materialsCatalogTable.deletedAt));
      return rows.map((r) => toItem("material", r.id, r.name || `#${r.id}`, r));
    },
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(materialsCatalogTable)
        .where(and(eq(materialsCatalogTable.id, id), isNotNull(materialsCatalogTable.deletedAt)));
      if (!existing) return null;
      await db.update(materialsCatalogTable).set(CLEAR).where(eq(materialsCatalogTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(materialsCatalogTable)
        .where(and(eq(materialsCatalogTable.id, id), isNotNull(materialsCatalogTable.deletedAt)));
      if (!existing) return null;
      await db.delete(materialsCatalogTable).where(eq(materialsCatalogTable.id, id));
      return existing;
    },
  },
  loaner: {
    list: async () => {
      const rows = await db
        .select()
        .from(loanersTable)
        .where(isNotNull(loanersTable.deletedAt))
        .orderBy(desc(loanersTable.deletedAt));
      return rows.map((r) =>
        toItem("loaner", r.id, `Zápůjčka #${r.id}${r.customerName ? ` — ${r.customerName}` : ""}`, r),
      );
    },
    parents: [
      parentLink(
        loanersTable,
        loanersTable.fleetVehicleId,
        vehiclesTable,
        "Zápůjčku nelze obnovit: vozidlo z vozového parku je v koši. Nejprve obnovte vozidlo.",
      ),
      parentLink(
        loanersTable,
        loanersTable.workOrderId,
        workOrdersTable,
        "Zápůjčku nelze obnovit: nadřazená zakázka je v koši. Nejprve obnovte zakázku.",
      ),
      parentLink(
        loanersTable,
        loanersTable.customerVehicleId,
        vehiclesTable,
        "Zápůjčku nelze obnovit: vozidlo zákazníka je v koši. Nejprve obnovte vozidlo.",
      ),
    ],
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(loanersTable)
        .where(and(eq(loanersTable.id, id), isNotNull(loanersTable.deletedAt)));
      if (!existing) return null;
      await db.update(loanersTable).set(CLEAR).where(eq(loanersTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(loanersTable)
        .where(and(eq(loanersTable.id, id), isNotNull(loanersTable.deletedAt)));
      if (!existing) return null;
      await db.delete(loanersTable).where(eq(loanersTable.id, id));
      return existing;
    },
  },
  appointment: {
    list: async () => {
      const rows = await db
        .select()
        .from(appointmentsTable)
        .where(isNotNull(appointmentsTable.deletedAt))
        .orderBy(desc(appointmentsTable.deletedAt));
      return rows.map((r) =>
        toItem("appointment", r.id, `Termín #${r.id}${r.customerName ? ` — ${r.customerName}` : ""}`, r),
      );
    },
    parents: [
      parentLink(
        appointmentsTable,
        appointmentsTable.vehicleId,
        vehiclesTable,
        "Termín nelze obnovit: nadřazené vozidlo je v koši. Nejprve obnovte vozidlo.",
      ),
    ],
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, id), isNotNull(appointmentsTable.deletedAt)));
      if (!existing) return null;
      await db.update(appointmentsTable).set(CLEAR).where(eq(appointmentsTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(appointmentsTable)
        .where(and(eq(appointmentsTable.id, id), isNotNull(appointmentsTable.deletedAt)));
      if (!existing) return null;
      await db.delete(appointmentsTable).where(eq(appointmentsTable.id, id));
      return existing;
    },
  },
  photo: {
    list: async () => {
      const rows = await db
        .select()
        .from(photosTable)
        .where(isNotNull(photosTable.deletedAt))
        .orderBy(desc(photosTable.deletedAt));
      return rows.map((r) => toItem("photo", r.id, r.filename || `Foto #${r.id}`, r));
    },
    parents: [
      parentLink(
        photosTable,
        photosTable.workOrderId,
        workOrdersTable,
        "Fotografii nelze obnovit: nadřazená zakázka je v koši. Nejprve obnovte zakázku.",
      ),
    ],
    restore: async (id) => {
      const [existing] = await db
        .select()
        .from(photosTable)
        .where(and(eq(photosTable.id, id), isNotNull(photosTable.deletedAt)));
      if (!existing) return null;
      await db.update(photosTable).set(CLEAR).where(eq(photosTable.id, id));
      return existing;
    },
    purge: async (id) => {
      const [existing] = await db
        .select()
        .from(photosTable)
        .where(and(eq(photosTable.id, id), isNotNull(photosTable.deletedAt)));
      if (!existing) return null;
      await db.delete(photosTable).where(eq(photosTable.id, id));
      return existing;
    },
    photoUrls: async (id) => {
      const [existing] = await db
        .select({ url: photosTable.url })
        .from(photosTable)
        .where(and(eq(photosTable.id, id), isNotNull(photosTable.deletedAt)));
      return existing ? [existing.url] : [];
    },
  },
};

function toItem(
  entity: TrashEntity,
  id: number,
  label: string,
  row: { deletedAt: Date | null; deletedBy: string | null; deleteReason: string | null },
): TrashItem {
  return {
    entity,
    id,
    label,
    deletedAt: (row.deletedAt ?? new Date()).toISOString(),
    deletedBy: row.deletedBy,
    deleteReason: row.deleteReason,
  };
}

function isTrashEntity(value: string): value is TrashEntity {
  return Object.prototype.hasOwnProperty.call(ENTITIES, value);
}

function parseId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

/** Every trashed item across all entities, most recently deleted first. */
export async function listAllTrashItems(): Promise<TrashItem[]> {
  const groups = await Promise.all(Object.values(ENTITIES).map((cfg) => cfg.list()));
  const items = groups.flat();
  items.sort((a, b) => b.deletedAt.localeCompare(a.deletedAt));
  return items;
}

export type PurgeResult =
  | { ok: true; purged: Snapshot }
  | { ok: false; reason: "not_found" | "blob_failed" };

/**
 * Permanently hard-delete one trashed item, reused by both the manual DELETE
 * route and the automatic retention cleanup. Frees object storage first: the
 * photo blobs this purge would orphan are deleted via the storage facade BEFORE
 * the DB rows (GDPR erasure ordering). A blob delete failure aborts the purge
 * (`blob_failed`) leaving the row intact so a retry is safe. `photoUrls` only
 * returns paths for a trashed, purge-eligible row, and deleteObject is
 * idempotent. The purge is audited under `actor`.
 */
export async function purgeTrashItem(
  entity: TrashEntity,
  id: number,
  actor: AuditActor,
  log: ErrorLogger,
): Promise<PurgeResult> {
  const cfg = ENTITIES[entity];

  if (cfg.photoUrls) {
    const urls = await cfg.photoUrls(id);
    if (urls.length > 0) {
      const results = await Promise.allSettled(urls.map((u) => storage.deleteObject(u)));
      const failed = results.filter((r) => r.status === "rejected");
      if (failed.length > 0) {
        log.error(
          { entity, id, failed: failed.length },
          "Trash purge aborted: failed to delete photo blobs from storage",
        );
        return { ok: false, reason: "blob_failed" };
      }
    }
  }

  const purged = await cfg.purge(id);
  if (!purged) return { ok: false, reason: "not_found" };

  await auditEntity.purged(entity, id, actor, purged);
  return { ok: true, purged };
}

// GET /trash — all trashed items across entities, most recently deleted first.
router.get("/trash", async (_req, res): Promise<void> => {
  res.json(await listAllTrashItems());
});

// POST /trash/:entity/:id/restore — clear soft-delete, audit the restore.
router.post("/trash/:entity/:id/restore", async (req, res): Promise<void> => {
  const entity = req.params.entity;
  if (!isTrashEntity(entity)) {
    res.status(404).json({ error: "Neznámý typ záznamu" });
    return;
  }
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  // Block restoring a child whose parent is still in the trash — it would come
  // back orphaned, attached to a hidden parent. Tell the user to restore the
  // parent first. (No-op for top-level entities, which have no parents.)
  for (const parent of ENTITIES[entity].parents ?? []) {
    if (await parent.parentTrashed(id)) {
      res.status(409).json({ error: parent.blockedMessage });
      return;
    }
  }

  const restored = await ENTITIES[entity].restore(id);
  if (!restored) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  await auditEntity.restored(entity, id, getActor(req), restored);
  res.json({ success: true, message: "Záznam byl obnoven." });
});

// DELETE /trash/:entity/:id — permanent hard delete, audit the purge.
router.delete("/trash/:entity/:id", async (req, res): Promise<void> => {
  const entity = req.params.entity;
  if (!isTrashEntity(entity)) {
    res.status(404).json({ error: "Neznámý typ záznamu" });
    return;
  }
  const id = parseId(req.params.id);
  if (id == null) {
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  const result = await purgeTrashItem(entity, id, getActor(req), req.log);
  if (!result.ok) {
    if (result.reason === "blob_failed") {
      res.status(500).json({
        error: "Smazání fotografií z úložiště selhalo. Záznam nebyl smazán, zkuste to znovu.",
      });
      return;
    }
    res.status(404).json({ error: "Záznam nenalezen" });
    return;
  }

  res.json({ success: true, message: "Záznam byl trvale smazán." });
});

export default router;
