import { describe, it, expect, vi, beforeEach } from "vitest";

const { sendMailMock, isMailConfiguredMock } = vi.hoisted(() => ({
  sendMailMock: vi.fn(async () => {}),
  isMailConfiguredMock: vi.fn(() => true),
}));

vi.mock("../mailer", () => ({
  sendMail: sendMailMock,
  isMailConfigured: isMailConfiguredMock,
}));

vi.mock("../logger", () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("@workspace/db", () => import("../../test-support/fake-db"));

import { runReminderDigest, maybeRunScheduledDigest } from "../reminders";
import { __store, settingsTable, vehiclesTable } from "../../test-support/fake-db";

function seedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    companyEmail: "company@example.com",
    notificationEmail: "owner@example.com",
    emailRemindersEnabled: true,
    reminderStkDays: 30,
    reminderServiceDays: 14,
    lastStkReminderSentAt: null,
    ...overrides,
  };
  __store.get(settingsTable).push(row);
  return row;
}

/** A vehicle whose STK expired long ago — guaranteed to produce one alert. */
function seedOverdueVehicle(): void {
  __store.get(vehiclesTable).push({
    id: 1,
    licensePlate: "1AB1234",
    make: "Skoda",
    model: "Octavia",
    ownerName: "Jan Novak",
    stkValidUntil: "2020-01-01",
    currentKm: null,
    transmission: "manual",
  });
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  isMailConfiguredMock.mockReturnValue(true);
});

describe("maybeRunScheduledDigest (once-per-day guard)", () => {
  it("sends at most one digest per calendar day", async () => {
    const settings = seedSettings({ lastStkReminderSentAt: null });
    seedOverdueVehicle();

    await maybeRunScheduledDigest();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    // The send timestamp is recorded so the guard can dedupe.
    expect(settings.lastStkReminderSentAt).toBeInstanceOf(Date);

    // A second tick on the same day must NOT send again.
    await maybeRunScheduledDigest();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("sends again once a new day has started", async () => {
    seedSettings({ lastStkReminderSentAt: daysAgo(2) });
    seedOverdueVehicle();

    await maybeRunScheduledDigest();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing when reminders are disabled", async () => {
    seedSettings({ emailRemindersEnabled: false, lastStkReminderSentAt: null });
    seedOverdueVehicle();

    await maybeRunScheduledDigest();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("does nothing when mail is not configured", async () => {
    seedSettings({ lastStkReminderSentAt: null });
    seedOverdueVehicle();
    isMailConfiguredMock.mockReturnValue(false);

    await maybeRunScheduledDigest();
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("swallows errors from the digest run (scheduler stays alive)", async () => {
    seedSettings({ lastStkReminderSentAt: null });
    seedOverdueVehicle();
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));

    await expect(maybeRunScheduledDigest()).resolves.toBeUndefined();
  });
});

describe("runReminderDigest", () => {
  it("sends a digest and records the send time when vehicles need attention", async () => {
    const settings = seedSettings({ lastStkReminderSentAt: null });
    seedOverdueVehicle();

    const result = await runReminderDigest();

    expect(result.sent).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as {
      to: string;
      subject: string;
    };
    expect(mail.to).toBe("owner@example.com");
    expect(settings.lastStkReminderSentAt).toBeInstanceOf(Date);
  });

  it("does not send when no vehicle needs attention", async () => {
    seedSettings({ lastStkReminderSentAt: null });
    // No vehicles seeded.

    const result = await runReminderDigest();

    expect(result.sent).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("manual run bypasses the enabled flag", async () => {
    seedSettings({ emailRemindersEnabled: false, lastStkReminderSentAt: null });
    seedOverdueVehicle();

    const result = await runReminderDigest({ manual: true });

    expect(result.sent).toBe(true);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
  });

  it("does not send (and reports) when no recipient is configured", async () => {
    seedSettings({
      notificationEmail: null,
      companyEmail: null,
      lastStkReminderSentAt: null,
    });
    seedOverdueVehicle();

    const result = await runReminderDigest();

    expect(result.sent).toBe(false);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
