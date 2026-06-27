import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * The retention cleanup permanently purges trashed items older than
 * TRASH_RETENTION_DAYS, reusing the same purge path as the manual DELETE route
 * (so photo blobs are freed before DB rows). The scheduler runs it once per
 * calendar day via settings.lastTrashCleanupAt. Backed by the relational
 * in-memory engine so the real isNotNull/where age filtering and audit writes
 * are exercised.
 */

const { deleteObject } = vi.hoisted(() => ({
  deleteObject: vi.fn<(url: string) => Promise<void>>(),
}));

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("../storage", () => ({
  getObjectStorageService: () => ({ deleteObject }),
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import { runTrashCleanup, maybeRunScheduledTrashCleanup } from "../trash-cleanup";
import {
  __store,
  seed,
  vehiclesTable,
  workOrdersTable,
  photosTable,
  settingsTable,
} from "../../test-support/rel-db/engine";

const DAY = 24 * 60 * 60 * 1000;

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * DAY);
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  deleteObject.mockResolvedValue();
  delete process.env["TRASH_RETENTION_DAYS"];
});

afterEach(() => {
  delete process.env["TRASH_RETENTION_DAYS"];
});

describe("runTrashCleanup", () => {
  it("purges items older than the retention window and keeps newer ones", async () => {
    seed(vehiclesTable, [
      { id: 1, licensePlate: "OLD 0001", deletedAt: daysAgo(40) },
      { id: 2, licensePlate: "NEW 0002", deletedAt: daysAgo(5) },
      { id: 3, licensePlate: "LIVE 0003", deletedAt: null },
    ]);

    const result = await runTrashCleanup();

    expect(result).toEqual({ purged: 1, failed: 0 });
    // Only the 40-day-old trashed vehicle was removed.
    expect(__store.rows("vehicles").map((r) => r.id)).toEqual([2, 3]);

    // The purge is audited under the system actor.
    const audits = __store.rows("audit_log");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      action: "entity_purged",
      entity: "vehicle",
      entityId: "1",
      actor: "system",
    });
  });

  it("frees photo storage before purging an expired work order", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "OLD 0001", deletedAt: daysAgo(60) },
    ]);
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg" },
    ]);

    const result = await runTrashCleanup();

    expect(result).toEqual({ purged: 1, failed: 0 });
    expect(deleteObject).toHaveBeenCalledWith("/objects/a.jpg");
    expect(__store.rows("work_orders")).toHaveLength(0);
  });

  it("counts an item as failed (and keeps it) when its blob delete fails", async () => {
    seed(workOrdersTable, [
      { id: 10, licensePlate: "OLD 0001", deletedAt: daysAgo(60) },
    ]);
    seed(photosTable, [
      { id: 1, workOrderId: 10, url: "/objects/a.jpg", filename: "a.jpg" },
    ]);
    deleteObject.mockRejectedValueOnce(new Error("storage down"));

    const result = await runTrashCleanup();

    expect(result).toEqual({ purged: 0, failed: 1 });
    // The row survives so the next run retries it.
    expect(__store.rows("work_orders")).toHaveLength(1);
    expect(__store.rows("audit_log")).toHaveLength(0);
  });

  it("honors a custom TRASH_RETENTION_DAYS", async () => {
    process.env["TRASH_RETENTION_DAYS"] = "10";
    seed(vehiclesTable, [
      { id: 1, licensePlate: "A 1", deletedAt: daysAgo(15) },
      { id: 2, licensePlate: "A 2", deletedAt: daysAgo(8) },
    ]);

    const result = await runTrashCleanup();

    expect(result).toEqual({ purged: 1, failed: 0 });
    expect(__store.rows("vehicles").map((r) => r.id)).toEqual([2]);
  });

  it("purges nothing when all trashed items are within the window", async () => {
    seed(vehiclesTable, [{ id: 1, licensePlate: "A 1", deletedAt: daysAgo(2) }]);
    const result = await runTrashCleanup();
    expect(result).toEqual({ purged: 0, failed: 0 });
    expect(__store.rows("vehicles")).toHaveLength(1);
  });
});

describe("maybeRunScheduledTrashCleanup", () => {
  it("runs and stamps lastTrashCleanupAt on the first tick of the day", async () => {
    seed(settingsTable, [{ id: 1, lastTrashCleanupAt: null }]);
    seed(vehiclesTable, [{ id: 1, licensePlate: "OLD 1", deletedAt: daysAgo(40) }]);

    await maybeRunScheduledTrashCleanup();

    expect(__store.rows("vehicles")).toHaveLength(0);
    const [settings] = __store.rows("settings");
    expect(settings.lastTrashCleanupAt).toBeInstanceOf(Date);
  });

  it("skips when a cleanup already ran today", async () => {
    seed(settingsTable, [{ id: 1, lastTrashCleanupAt: new Date() }]);
    seed(vehiclesTable, [{ id: 1, licensePlate: "OLD 1", deletedAt: daysAgo(40) }]);

    await maybeRunScheduledTrashCleanup();

    // Nothing was purged because the once-per-day guard short-circuited.
    expect(__store.rows("vehicles")).toHaveLength(1);
  });

  it("runs again when the last cleanup was on a previous day", async () => {
    seed(settingsTable, [{ id: 1, lastTrashCleanupAt: daysAgo(2) }]);
    seed(vehiclesTable, [{ id: 1, licensePlate: "OLD 1", deletedAt: daysAgo(40) }]);

    await maybeRunScheduledTrashCleanup();

    expect(__store.rows("vehicles")).toHaveLength(0);
  });

  it("does nothing when the settings row does not exist yet", async () => {
    // No settings row seeded — a fresh deployment before bootstrap. The guard
    // must short-circuit so cleanup doesn't run every tick against a 0-row update.
    seed(vehiclesTable, [{ id: 1, licensePlate: "OLD 1", deletedAt: daysAgo(40) }]);

    await maybeRunScheduledTrashCleanup();

    expect(__store.rows("vehicles")).toHaveLength(1);
  });
});
