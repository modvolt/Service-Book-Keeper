import { describe, it, expect, vi, beforeEach } from "vitest";
import express, { type Express } from "express";
import request from "supertest";
import crypto from "node:crypto";

const { sendMailMock, isMailConfiguredMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => {}),
  isMailConfiguredMock: vi.fn(() => true),
}));

vi.mock("../../lib/mailer", () => ({
  sendMail: sendMailMock,
  isMailConfigured: isMailConfiguredMock,
}));

vi.mock("../../lib/logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/fake-db"));

import authRouter from "../auth";
import { __store, appAuthTable, settingsTable, auditLogTable } from "../../test-support/fake-db";

function makeApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(authRouter);
  return app;
}

function sha256(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function seedSettings(email: string | null): void {
  __store.get(settingsTable).push({
    id: 1,
    companyEmail: null,
    notificationEmail: email,
  });
}

function seedAuth(row: Record<string, unknown> = {}): void {
  __store.get(appAuthTable).push({
    id: 1,
    passwordHash: "OLD-HASH",
    resetTokenHash: null,
    resetTokenExpiresAt: null,
    ...row,
  });
}

const GENERIC =
  "Pokud e-mail odpovídá nastavené adrese, byl odeslán odkaz pro obnovu hesla.";

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  isMailConfiguredMock.mockReturnValue(true);
  process.env.APP_URL = "https://app.example.com";
});

describe("POST /auth/forgot-password (no user enumeration)", () => {
  it("returns the generic message for an unknown / non-matching email and sends nothing", async () => {
    seedSettings("owner@example.com");
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/forgot-password")
      .send({ email: "stranger@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC });
    expect(sendMailMock).not.toHaveBeenCalled();
    // No reset token should be issued for a non-matching address.
    const [auth] = __store.get(appAuthTable);
    expect(auth.resetTokenHash).toBeNull();
  });

  it("returns the same generic message for an invalid body (no error leak)", async () => {
    seedSettings("owner@example.com");
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/forgot-password")
      .send({ email: "" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC });
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("returns the generic message when mail is not configured (still no send)", async () => {
    seedSettings("owner@example.com");
    seedAuth();
    isMailConfiguredMock.mockReturnValue(false);

    const res = await request(makeApp())
      .post("/auth/forgot-password")
      .send({ email: "owner@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC });
    expect(sendMailMock).not.toHaveBeenCalled();
    const [auth] = __store.get(appAuthTable);
    expect(auth.resetTokenHash).toBeNull();
  });

  it("for a matching email: issues a hashed token, emails a link, and stays generic", async () => {
    seedSettings("owner@example.com");
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/forgot-password")
      .send({ email: "  OWNER@example.com " });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC });

    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as {
      to: string;
      text: string;
      html: string;
    };
    expect(mail.to).toBe("owner@example.com");

    // A reset token hash + future expiry must be persisted.
    const [auth] = __store.get(appAuthTable);
    expect(typeof auth.resetTokenHash).toBe("string");
    expect((auth.resetTokenHash as string).length).toBe(64);
    expect((auth.resetTokenExpiresAt as Date).getTime()).toBeGreaterThan(Date.now());

    // The raw token in the link must hash to the stored hash (never stored raw).
    const match = /token=([a-f0-9]+)/.exec(mail.text);
    expect(match).not.toBeNull();
    const rawToken = match![1];
    expect(sha256(rawToken)).toBe(auth.resetTokenHash);
    expect(mail.text).toContain("https://app.example.com/reset-hesla?token=");
  });

  it("does not send when no trusted base URL is available", async () => {
    delete process.env.APP_URL;
    delete process.env.REPLIT_DEV_DOMAIN;
    process.env.NODE_ENV = "production";
    seedSettings("owner@example.com");
    seedAuth();

    const res = await request(makeApp())
      .post("/auth/forgot-password")
      .send({ email: "owner@example.com" });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ message: GENERIC });
    expect(sendMailMock).not.toHaveBeenCalled();
    delete process.env.NODE_ENV;
  });
});

describe("POST /auth/reset-password", () => {
  it("rejects when no reset token has been issued", async () => {
    seedAuth({ resetTokenHash: null, resetTokenExpiresAt: null });

    const res = await request(makeApp())
      .post("/auth/reset-password")
      .send({ token: "anything", newPassword: "newpassword123" });

    expect(res.status).toBe(400);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe("OLD-HASH");
  });

  it("rejects an expired token", async () => {
    seedAuth({
      resetTokenHash: sha256("tok"),
      resetTokenExpiresAt: new Date(Date.now() - 1000),
    });

    const res = await request(makeApp())
      .post("/auth/reset-password")
      .send({ token: "tok", newPassword: "newpassword123" });

    expect(res.status).toBe(400);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe("OLD-HASH");
  });

  it("rejects a non-matching (wrong) token", async () => {
    seedAuth({
      resetTokenHash: sha256("real-token"),
      resetTokenExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(makeApp())
      .post("/auth/reset-password")
      .send({ token: "wrong-token", newPassword: "newpassword123" });

    expect(res.status).toBe(400);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe("OLD-HASH");
    // A failed attempt must not clear the still-valid token.
    expect(auth.resetTokenHash).toBe(sha256("real-token"));
  });

  it("accepts a valid token, updates the password, and makes the token single-use", async () => {
    seedAuth({
      resetTokenHash: sha256("good-token"),
      resetTokenExpiresAt: new Date(Date.now() + 60_000),
    });
    const app = makeApp();

    const res = await request(app)
      .post("/auth/reset-password")
      .send({ token: "good-token", newPassword: "newpassword123" });

    expect(res.status).toBe(204);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).not.toBe("OLD-HASH");
    expect(typeof auth.passwordHash).toBe("string");
    expect(auth.resetTokenHash).toBeNull();
    expect(auth.resetTokenExpiresAt).toBeNull();

    // Reusing the same token must now fail (single-use).
    const reuse = await request(app)
      .post("/auth/reset-password")
      .send({ token: "good-token", newPassword: "anotherpass123" });
    expect(reuse.status).toBe(400);
  });

  it("rejects a too-short new password before touching state", async () => {
    seedAuth({
      resetTokenHash: sha256("good-token"),
      resetTokenExpiresAt: new Date(Date.now() + 60_000),
    });

    const res = await request(makeApp())
      .post("/auth/reset-password")
      .send({ token: "good-token", newPassword: "short" });

    expect(res.status).toBe(400);
    const [auth] = __store.get(appAuthTable);
    expect(auth.passwordHash).toBe("OLD-HASH");
    expect(auditLogTable).toBeDefined();
  });
});
