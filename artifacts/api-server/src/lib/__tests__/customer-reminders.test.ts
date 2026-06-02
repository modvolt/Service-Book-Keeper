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

import {
  runCustomerReminders,
  maybeRunScheduledCustomerReminders,
} from "../reminders";
import {
  __store,
  settingsTable,
  vehiclesTable,
  customerReminderLogTable,
} from "../../test-support/fake-db";

function seedSettings(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    companyName: "Autoservis Novák",
    companyPhone: "+420 123 456 789",
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

interface VehicleSeed {
  id?: number;
  licensePlate?: string;
  ownerEmail?: string | null;
  consentGivenAt?: Date | null;
  stkValidUntil?: string | null;
  transmission?: string;
}

/** A vehicle whose STK expired long ago — guaranteed to produce one STK alert. */
function seedVehicle(overrides: VehicleSeed = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: 1,
    licensePlate: "1AB1234",
    make: "Skoda",
    model: "Octavia",
    ownerName: "Jan Novak",
    ownerEmail: "jan@example.com",
    consentGivenAt: new Date("2025-01-01T00:00:00Z"),
    stkValidUntil: "2020-01-01",
    currentKm: null,
    transmission: "manual",
    ...overrides,
  };
  __store.get(vehiclesTable).push(row);
  return row;
}

function logRows(): Record<string, unknown>[] {
  return __store.get(customerReminderLogTable);
}

beforeEach(() => {
  __store.reset();
  vi.clearAllMocks();
  isMailConfiguredMock.mockReturnValue(true);
});

describe("runCustomerReminders — eligibility", () => {
  it("emails the owner about a due deadline and records the ledger", async () => {
    seedSettings();
    seedVehicle();

    const result = await runCustomerReminders();

    expect(result.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    const mail = (sendMailMock.mock.calls[0] as unknown[])[0] as {
      to: string;
      subject: string;
      text: string;
    };
    expect(mail.to).toBe("jan@example.com");
    expect(mail.subject).toContain("1AB1234");
    expect(mail.text).toContain("STK");
    expect(logRows()).toHaveLength(1);
  });

  it("skips owners without recorded consent", async () => {
    seedSettings();
    seedVehicle({ consentGivenAt: null });

    const result = await runCustomerReminders();

    expect(result.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
    expect(logRows()).toHaveLength(0);
  });

  it("skips owners without an email address", async () => {
    seedSettings();
    seedVehicle({ ownerEmail: null });

    const result = await runCustomerReminders();

    expect(result.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("does not send when no deadline is near", async () => {
    seedSettings();
    seedVehicle({ stkValidUntil: "2099-01-01" });

    const result = await runCustomerReminders();

    expect(result.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("runCustomerReminders — de-duplication", () => {
  it("does not email the same deadline twice across runs", async () => {
    seedSettings();
    seedVehicle();

    await runCustomerReminders();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(logRows()).toHaveLength(1);

    const second = await runCustomerReminders();
    expect(sendMailMock).toHaveBeenCalledTimes(1);
    expect(second.sent).toBe(0);
    expect(second.skipped).toBe(1);
  });

  it("emails again once the deadline period changes (STK renewed)", async () => {
    seedSettings();
    const vehicle = seedVehicle();

    await runCustomerReminders();
    expect(sendMailMock).toHaveBeenCalledTimes(1);

    // STK renewed but still within the warning window → new period, new email.
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    vehicle.stkValidUntil = soon;

    const result = await runCustomerReminders();
    expect(result.sent).toBe(1);
    expect(sendMailMock).toHaveBeenCalledTimes(2);
    expect(logRows()).toHaveLength(2);
  });

  it("does not write the ledger when the send fails (retried next run)", async () => {
    seedSettings();
    seedVehicle();
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));

    const result = await runCustomerReminders();
    expect(result.sent).toBe(0);
    expect(logRows()).toHaveLength(0);

    // Next run succeeds and now records the ledger.
    const retry = await runCustomerReminders();
    expect(retry.sent).toBe(1);
    expect(logRows()).toHaveLength(1);
  });
});

describe("runCustomerReminders — gating", () => {
  it("does nothing when reminders are disabled", async () => {
    seedSettings({ emailRemindersEnabled: false });
    seedVehicle();

    const result = await runCustomerReminders();
    expect(result.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });

  it("manual run bypasses the disabled flag", async () => {
    seedSettings({ emailRemindersEnabled: false });
    seedVehicle();

    const result = await runCustomerReminders({ manual: true });
    expect(result.sent).toBe(1);
  });

  it("does nothing when mail is not configured", async () => {
    seedSettings();
    seedVehicle();
    isMailConfiguredMock.mockReturnValue(false);

    const result = await runCustomerReminders();
    expect(result.sent).toBe(0);
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});

describe("maybeRunScheduledCustomerReminders", () => {
  it("runs and swallows errors to keep the scheduler alive", async () => {
    seedSettings();
    seedVehicle();
    sendMailMock.mockRejectedValueOnce(new Error("smtp down"));

    await expect(maybeRunScheduledCustomerReminders()).resolves.toBeUndefined();
  });

  it("skips when reminders are disabled", async () => {
    seedSettings({ emailRemindersEnabled: false });
    seedVehicle();

    await maybeRunScheduledCustomerReminders();
    expect(sendMailMock).not.toHaveBeenCalled();
  });
});
