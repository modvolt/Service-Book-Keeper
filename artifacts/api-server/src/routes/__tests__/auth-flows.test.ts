import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import session from "express-session";
import request from "supertest";
import bcrypt from "bcryptjs";

vi.mock("../../lib/mailer", () => ({
  sendMail: vi.fn(async () => {}),
  isMailConfigured: vi.fn(() => true),
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/fake-db"));

import authRouter from "../auth";
import { __store, appAuthTable, auditLogTable } from "../../test-support/fake-db";

const PASSWORD = "correct-horse";
// Low cost factor keeps the suite fast; the hash format is identical to prod.
const PASSWORD_HASH = bcrypt.hashSync(PASSWORD, 4);

/**
 * Build an app wired with a real in-memory session (express-session's default
 * MemoryStore) so the login -> change-password -> logout flow exercises the
 * actual session lifecycle (regenerate / destroy) instead of a stub.
 */
function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: "test-secret",
      resave: false,
      // Persist the anonymous session so we can capture its id and prove that
      // login rotates it (session-fixation prevention).
      saveUninitialized: true,
      name: "autoservis.sid",
    }),
  );
  app.use(authRouter);
  return app;
}

function seedAuth(passwordHash: string = PASSWORD_HASH): void {
  __store.get(appAuthTable).push({
    id: 1,
    passwordHash,
    resetTokenHash: null,
    resetTokenExpiresAt: null,
  });
}

function auditActions(): string[] {
  return __store.get(auditLogTable).map((r) => r.action as string);
}

function sidFrom(res: request.Response): string | null {
  const cookies = (res.headers["set-cookie"] as unknown as string[]) ?? [];
  const c = cookies.find((x) => x.startsWith("autoservis.sid="));
  return c ? c.split(";")[0].split("=")[1] : null;
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  delete process.env.APP_PASSWORD;
});

describe("POST /auth/login", () => {
  it("rejects a wrong password with 401 and records a login_failed audit", async () => {
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/login")
      .send({ password: "wrong-password" });

    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: "Nesprávné heslo" });
    expect(auditActions()).toContain("login_failed");
    expect(auditActions()).not.toContain("login");
  });

  it("accepts the correct password, rotates the session id, and records a login audit", async () => {
    seedAuth();
    const agent = request.agent(makeApp());

    // Establish an anonymous session first so we have a baseline session id.
    const before = await agent.get("/auth/me");
    const sidBefore = sidFrom(before);
    expect(sidBefore).not.toBeNull();

    const res = await agent.post("/auth/login").send({ password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ authenticated: true, role: "admin" });

    // The session id must change on login to prevent session fixation.
    const sidAfter = sidFrom(res);
    expect(sidAfter).not.toBeNull();
    expect(sidAfter).not.toBe(sidBefore);

    // The rotated session must report as authenticated on a follow-up request.
    const me = await agent.get("/auth/me");
    expect(me.body).toEqual({ authenticated: true, role: "admin", scannerEnabled: false });

    expect(auditActions()).toContain("login");
  });

  it("returns 503 when no password is configured", async () => {
    // No auth row seeded and no APP_PASSWORD env -> nothing to authenticate against.
    const res = await request(makeApp())
      .post("/auth/login")
      .send({ password: "anything" });

    expect(res.status).toBe(503);
    expect(auditActions()).not.toContain("login");
  });

  it("rejects a malformed body with 400 before checking credentials", async () => {
    seedAuth();

    const res = await request(makeApp()).post("/auth/login").send({});

    expect(res.status).toBe(400);
    expect(auditActions()).not.toContain("login_failed");
  });
});

describe("POST /auth/change-password", () => {
  it("requires an authenticated session (401 when not logged in)", async () => {
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "brand-new-pass" });

    expect(res.status).toBe(401);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe(PASSWORD_HASH);
  });

  it("rejects a wrong current password with 400 and leaves the hash unchanged", async () => {
    seedAuth();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: PASSWORD });

    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: "not-the-password", newPassword: "brand-new-pass" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: "Současné heslo je nesprávné" });
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe(PASSWORD_HASH);
  });

  it("enforces the 8-character minimum on the new password", async () => {
    seedAuth();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: PASSWORD });

    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "short" });

    expect(res.status).toBe(400);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe(PASSWORD_HASH);
    expect(auditActions()).not.toContain("password_changed");
  });

  it("changes the password for an authenticated session and records an audit", async () => {
    seedAuth();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: PASSWORD });

    const res = await agent
      .post("/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "a-fresh-password" });

    expect(res.status).toBe(204);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).not.toBe(PASSWORD_HASH);
    expect(bcrypt.compareSync("a-fresh-password", auth.passwordHash as string)).toBe(true);
    expect(auditActions()).toContain("password_changed");
  });
});

describe("POST /auth/logout", () => {
  it("destroys the session and records a logout audit when authenticated", async () => {
    seedAuth();
    const agent = request.agent(makeApp());
    await agent.post("/auth/login").send({ password: PASSWORD });

    const res = await agent.post("/auth/logout");
    expect(res.status).toBe(204);
    expect(auditActions()).toContain("logout");

    // After logout the session must no longer be authenticated, so a
    // protected action is rejected.
    const change = await agent
      .post("/auth/change-password")
      .send({ currentPassword: PASSWORD, newPassword: "another-password" });
    expect(change.status).toBe(401);

    const me = await agent.get("/auth/me");
    expect(me.body).toEqual({ authenticated: false, role: null, scannerEnabled: false });
  });

  it("does not record a logout audit when there was no authenticated session", async () => {
    const res = await request(makeApp()).post("/auth/logout");

    expect(res.status).toBe(204);
    expect(auditActions()).not.toContain("logout");
  });
});
