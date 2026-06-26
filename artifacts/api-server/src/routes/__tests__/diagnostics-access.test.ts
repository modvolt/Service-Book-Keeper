import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import request from "supertest";

/**
 * Access control for the diagnostics page + error feed. The endpoints expose
 * stack traces and dependency state, so they must be admin-only by default and
 * only public when ENABLE_PUBLIC_DIAGNOSTICS is explicitly turned on. This also
 * guards the secret-scrubbing: an error containing a credential must never come
 * back through the feed verbatim.
 */

// readiness.ts (imported transitively by diagnostics.ts) pulls in the DB and
// storage layers at module load; stub them so the router imports cleanly.
vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));
vi.mock("@workspace/db", () => ({ pingDatabase: vi.fn(async () => {}) }));
vi.mock("../../lib/storage", () => ({
  getObjectStorageService: () => ({ healthCheck: vi.fn(async () => {}) }),
}));

import diagnosticsRouter from "../diagnostics";
import { recordError } from "../../lib/error-buffer";

type Role = "admin" | "scanner";

function makeApp(role: Role | null): Express {
  const app = express();
  app.use((req: Request, _res: Response, next: NextFunction) => {
    if (role) (req as unknown as { session: unknown }).session = { authenticated: true, role };
    next();
  });
  app.use("/api", diagnosticsRouter);
  return app;
}

beforeEach(() => {
  delete process.env.ENABLE_PUBLIC_DIAGNOSTICS;
});

afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.ENABLE_PUBLIC_DIAGNOSTICS;
});

describe("diagnostics access — secure by default (no ENABLE_PUBLIC_DIAGNOSTICS)", () => {
  it("rejects an unauthenticated error-feed request with 401", async () => {
    const res = await request(makeApp(null)).get("/api/diagnostics/errors");
    expect(res.status).toBe(401);
  });

  it("rejects the unauthenticated HTML page with 401", async () => {
    const res = await request(makeApp(null)).get("/api/diagnostics");
    expect(res.status).toBe(401);
  });

  it("rejects a non-admin (scanner) session with 403", async () => {
    const res = await request(makeApp("scanner")).get("/api/diagnostics/errors");
    expect(res.status).toBe(403);
  });

  it("allows an admin session through (200 with readiness + errors)", async () => {
    const res = await request(makeApp("admin")).get("/api/diagnostics/errors");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("readiness");
    expect(res.body).toHaveProperty("errors");
  });
});

describe("diagnostics access — ENABLE_PUBLIC_DIAGNOSTICS opt-in", () => {
  it("serves the feed to an unauthenticated request when the flag is on", async () => {
    process.env.ENABLE_PUBLIC_DIAGNOSTICS = "true";
    const res = await request(makeApp(null)).get("/api/diagnostics/errors");
    expect(res.status).toBe(200);
  });

  it("treats off-ish values as secure (does not expose)", async () => {
    process.env.ENABLE_PUBLIC_DIAGNOSTICS = "false";
    const res = await request(makeApp(null)).get("/api/diagnostics/errors");
    expect(res.status).toBe(401);
  });
});

describe("diagnostics feed never leaks secrets", () => {
  it("scrubs credential-looking strings out of the recorded error before it is served", async () => {
    process.env.ENABLE_PUBLIC_DIAGNOSTICS = "true";
    recordError(
      new Error("connect failed postgres://app:SuperSecretPass@db:5432/autoservis using sk-abcdef1234567890"),
      "test",
    );
    const res = await request(makeApp(null)).get("/api/diagnostics/errors");
    expect(res.status).toBe(200);
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("SuperSecretPass");
    expect(body).not.toContain("sk-abcdef1234567890");
    expect(body).toContain("[REDACTED]");
  });
});
