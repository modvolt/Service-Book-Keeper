import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The audit helper must persist a sanitized snapshot — any key that looks like a
 * secret (password, token, hash, session, ...) is redacted before it ever
 * reaches the audit_log, even though business tables don't currently hold
 * secrets. Backed by the relational in-memory engine.
 */

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/rel-db/db-mock"));
vi.mock("drizzle-orm", () => import("../../test-support/rel-db/orm-mock"));
vi.mock("drizzle-orm/pg-core", () => import("../../test-support/rel-db/pgcore-mock"));

import { audit, auditEntity } from "../audit";
import { __store } from "../../test-support/rel-db/engine";

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
});

describe("audit snapshot sanitization", () => {
  it("redacts sensitive keys at any depth and serializes dates", async () => {
    await audit("entity_updated", {
      entity: "vehicle",
      entityId: 1,
      actor: "admin",
      snapshot: {
        licensePlate: "1A0 0001",
        passwordHash: "super-secret",
        nested: { sessionToken: "abc", apiKey: "k", ownerName: "Jan" },
        createdAt: new Date("2026-01-01T00:00:00Z"),
      },
    });

    const [row] = __store.rows("audit_log");
    expect(row).toMatchObject({ action: "entity_updated", entity: "vehicle", entityId: "1", actor: "admin" });

    const snap = JSON.parse(row.snapshot as string);
    expect(snap.licensePlate).toBe("1A0 0001");
    expect(snap.passwordHash).toBe("[redacted]");
    expect(snap.nested.sessionToken).toBe("[redacted]");
    expect(snap.nested.apiKey).toBe("[redacted]");
    expect(snap.nested.ownerName).toBe("Jan");
    expect(snap.createdAt).toBe("2026-01-01T00:00:00.000Z");
  });

  it("stores no snapshot when none is provided", async () => {
    await audit("login", { actor: "admin" });
    const [row] = __store.rows("audit_log");
    expect(row.snapshot).toBeNull();
  });

  it("auditEntity wrappers map to the right action codes", async () => {
    await auditEntity.created("material", 5, "admin", { name: "Olej" });
    await auditEntity.deleted("material", 5, "scanner", { name: "Olej" });

    const actions = __store.rows("audit_log").map((r) => r.action);
    expect(actions).toEqual(["entity_created", "entity_deleted"]);
    expect(__store.rows("audit_log")[1].actor).toBe("scanner");
  });
});
