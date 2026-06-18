import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";

vi.mock("../../lib/mailer", () => ({
  sendMail: vi.fn(async () => {}),
  isMailConfigured: vi.fn(() => false),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/fake-db"));

import authRouter from "../auth";
import { requireAuth, requireAdmin, requireScannerOrAdmin } from "../../middlewares/requireAuth";
import { __store, appAuthTable } from "../../test-support/fake-db";

const ADMIN_PASSWORD = "admin-horse";
const SCANNER_PASSWORD = "scanner-horse";
const ADMIN_HASH = bcrypt.hashSync(ADMIN_PASSWORD, 4);
const SCANNER_HASH = bcrypt.hashSync(SCANNER_PASSWORD, 4);

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      saveUninitialized: true,
      name: "autoservis.sid",
    }),
  );
  app.use(authRouter);

  // Minimal protected route stubs to verify gate behaviour.
  app.get("/admin-only", requireAuth, requireAdmin, (_req, res) => res.json({ ok: true }));
  app.get("/scan-or-admin", requireAuth, requireScannerOrAdmin, (_req, res) => res.json({ ok: true }));
  return app;
}

function seedAdmin(): void {
  __store.get(appAuthTable).push({
    id: 1,
    passwordHash: ADMIN_HASH,
    role: "admin",
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });
}

function seedScanner(): void {
  __store.get(appAuthTable).push({
    id: 2,
    passwordHash: SCANNER_HASH,
    role: "scanner",
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  delete process.env.APP_PASSWORD;
  delete process.env.SCANNER_PASSWORD;
});

describe("Scanner login", () => {
  it("authenticates with SCANNER_PASSWORD and returns role=scanner", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;

    const res = await request(makeApp())
      .post("/auth/login")
      .send({ password: SCANNER_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true, role: "scanner" });
  });

  it("admin login still returns role=admin when both accounts exist", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;

    const res = await request(makeApp())
      .post("/auth/login")
      .send({ password: ADMIN_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true, role: "admin" });
  });

  it("wrong password returns 401 even when both rows exist", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;

    const res = await request(makeApp())
      .post("/auth/login")
      .send({ password: "totally-wrong" });

    expect(res.status).toBe(401);
  });
});

describe("GET /auth/me role field", () => {
  it("returns role=null when not authenticated", async () => {
    const res = await request(makeApp()).get("/auth/me");
    expect(res.body).toEqual({ authenticated: false, role: null, scannerEnabled: false });
  });

  it("returns role=admin for an admin session", async () => {
    seedAdmin();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: ADMIN_PASSWORD });

    const me = await agent.get("/auth/me");
    expect(me.body).toEqual({ authenticated: true, role: "admin", scannerEnabled: false });
  });

  it("returns role=scanner for a scanner session", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: SCANNER_PASSWORD });

    const me = await agent.get("/auth/me");
    expect(me.body).toEqual({ authenticated: true, role: "scanner", scannerEnabled: true });
  });
});

describe("requireAdmin gate", () => {
  it("allows admin sessions through", async () => {
    seedAdmin();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: ADMIN_PASSWORD });

    const res = await agent.get("/admin-only");
    expect(res.status).toBe(200);
  });

  it("blocks scanner sessions with 403", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: SCANNER_PASSWORD });

    const res = await agent.get("/admin-only");
    expect(res.status).toBe(403);
  });

  it("blocks unauthenticated requests with 401", async () => {
    const res = await request(makeApp()).get("/admin-only");
    expect(res.status).toBe(401);
  });
});

describe("requireScannerOrAdmin gate", () => {
  it("allows admin sessions through", async () => {
    seedAdmin();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: ADMIN_PASSWORD });

    const res = await agent.get("/scan-or-admin");
    expect(res.status).toBe(200);
  });

  it("allows scanner sessions through", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: SCANNER_PASSWORD });

    const res = await agent.get("/scan-or-admin");
    expect(res.status).toBe(200);
  });

  it("blocks unauthenticated requests with 401", async () => {
    const res = await request(makeApp()).get("/scan-or-admin");
    expect(res.status).toBe(401);
  });
});

describe("change-password role restriction", () => {
  it("allows admin to change password", async () => {
    seedAdmin();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: ADMIN_PASSWORD });

    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: ADMIN_PASSWORD, newPassword: "new-password-ok" });

    expect(res.status).toBe(204);
  });

  it("rejects scanner attempting to change password with 403", async () => {
    seedAdmin();
    seedScanner();
    process.env.SCANNER_PASSWORD = SCANNER_PASSWORD;
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: SCANNER_PASSWORD });

    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: SCANNER_PASSWORD, newPassword: "new-password-ok" });

    expect(res.status).toBe(403);
  });
});
