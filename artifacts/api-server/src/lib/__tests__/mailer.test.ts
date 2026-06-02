import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { sendMailMock, createTransportMock } = vi.hoisted(() => {
  const sendMailMock = vi.fn(async () => ({ messageId: "fake" }));
  const createTransportMock = vi.fn(() => ({ sendMail: sendMailMock }));
  return { sendMailMock, createTransportMock };
});

vi.mock("nodemailer", () => ({
  default: { createTransport: createTransportMock },
}));

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

const ENV_KEYS = [
  "SMTP_HOST",
  "SMTP_USER",
  "SMTP_PASS",
  "SMTP_PORT",
  "SMTP_SECURE",
  "MAIL_FROM",
];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = {};
  for (const k of ENV_KEYS) {
    saved[k] = process.env[k];
    delete process.env[k];
  }
  vi.resetModules();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

async function importMailer() {
  return import("../mailer");
}

function setBaseSmtpEnv() {
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "robot@example.com";
  process.env.SMTP_PASS = "secret-app-password";
}

describe("readMailConfig / isMailConfigured", () => {
  it("returns null and reports unconfigured when SMTP env is incomplete", async () => {
    const { readMailConfig, isMailConfigured } = await importMailer();
    expect(readMailConfig()).toBeNull();
    expect(isMailConfigured()).toBe(false);

    // Host + user but no pass is still incomplete.
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "robot@example.com";
    expect(readMailConfig()).toBeNull();
    expect(isMailConfigured()).toBe(false);
  });

  it("parses a full config with defaults (port 587, insecure, from = user)", async () => {
    setBaseSmtpEnv();
    const { readMailConfig, isMailConfigured } = await importMailer();

    expect(isMailConfigured()).toBe(true);
    expect(readMailConfig()).toEqual({
      host: "smtp.example.com",
      port: 587,
      secure: false,
      user: "robot@example.com",
      pass: "secret-app-password",
      from: "robot@example.com",
    });
  });

  it("honours custom port, secure flag and MAIL_FROM override", async () => {
    setBaseSmtpEnv();
    process.env.SMTP_PORT = "465";
    process.env.SMTP_SECURE = "true";
    process.env.MAIL_FROM = "AutoServis <noreply@example.com>";
    const { readMailConfig } = await importMailer();

    expect(readMailConfig()).toMatchObject({
      port: 465,
      secure: true,
      from: "AutoServis <noreply@example.com>",
    });
  });

  it("throws on an invalid SMTP_PORT", async () => {
    setBaseSmtpEnv();
    process.env.SMTP_PORT = "not-a-number";
    const { readMailConfig } = await importMailer();
    expect(() => readMailConfig()).toThrow(/Invalid SMTP_PORT/);
  });
});

describe("sendMail", () => {
  it("sends through the (fake) transport with the configured fields", async () => {
    setBaseSmtpEnv();
    const { sendMail } = await importMailer();

    await sendMail({
      to: "owner@example.com",
      subject: "Hello",
      text: "Plain body",
      html: "<p>Rich body</p>",
    });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(createTransportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "smtp.example.com",
        port: 587,
        secure: false,
        auth: { user: "robot@example.com", pass: "secret-app-password" },
      }),
    );
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledWith({
      from: "robot@example.com",
      to: "owner@example.com",
      subject: "Hello",
      text: "Plain body",
      html: "<p>Rich body</p>",
    });
  });

  it("reuses a single transport across multiple sends", async () => {
    setBaseSmtpEnv();
    const { sendMail } = await importMailer();

    await sendMail({ to: "a@example.com", subject: "1", text: "1" });
    await sendMail({ to: "b@example.com", subject: "2", text: "2" });

    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
  });

  it("throws when SMTP is not configured (no email attempted)", async () => {
    const { sendMail } = await importMailer();
    await expect(
      sendMail({ to: "owner@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow(/není nakonfigurován/i);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("re-throws when the transport fails to send", async () => {
    setBaseSmtpEnv();
    sendMailMock.mockRejectedValueOnce(new Error("smtp boom"));
    const { sendMail } = await importMailer();

    await expect(
      sendMail({ to: "owner@example.com", subject: "x", text: "y" }),
    ).rejects.toThrow("smtp boom");
  });
});
