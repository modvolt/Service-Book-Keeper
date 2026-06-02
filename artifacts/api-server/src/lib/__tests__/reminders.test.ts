import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

// ---------------------------------------------------------------------------
// Core alert logic: which vehicles are flagged, and as overdue vs due-soon.
//
// The alert helpers (stkAlert / serviceAlert / computeVehicleAlerts) are not
// exported, so they are exercised through runReminderDigest and asserted via
// the captured email subject/body. Time is frozen so the date- and km-based
// boundaries are deterministic.
// ---------------------------------------------------------------------------

/** Frozen "today" for all boundary math below (mid-month avoids overflow). */
const NOW = new Date("2026-06-15T12:00:00Z");

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A YYYY-MM-DD date `n` days from the frozen NOW (negative = past). */
function dateInDays(n: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}

/** A YYYY-MM-DD date `n` months from the frozen NOW (negative = past). */
function dateInMonths(n: number): string {
  const d = new Date(NOW);
  d.setUTCMonth(d.getUTCMonth() + n);
  return isoDate(d);
}

let nextVehicleId = 1;

/** Seed a vehicle with every service/STK field null unless overridden. */
function seedVehicle(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const row: Record<string, unknown> = {
    id: nextVehicleId++,
    licensePlate: `P${nextVehicleId}AAA`,
    make: "Skoda",
    model: "Octavia",
    ownerName: null,
    transmission: "manual",
    currentKm: null,
    stkValidUntil: null,
    lastOilChangeKm: null,
    lastOilChangeDate: null,
    lastBrakesDate: null,
    lastTimingDate: null,
    lastTransmissionOilDate: null,
    lastTransmissionOilKm: null,
    lastBrakeFluidDate: null,
    oilChangeIntervalKm: null,
    oilChangeIntervalMonths: null,
    transmissionOilIntervalKm: null,
    transmissionOilIntervalMonths: null,
    brakesIntervalMonths: null,
    timingIntervalKm: null,
    timingIntervalMonths: null,
    brakeFluidIntervalMonths: null,
    ...overrides,
  };
  __store.get(vehiclesTable).push(row);
  return row;
}

interface Mail {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** The most recently sent email (the digest), or undefined if none was sent. */
function lastMail(): Mail | undefined {
  const call = sendMailMock.mock.calls.at(-1) as unknown[] | undefined;
  return call?.[0] as Mail | undefined;
}

/** Run the digest and return the captured email (must have been sent). */
async function digestMail(): Promise<Mail> {
  const result = await runReminderDigest();
  expect(result.sent).toBe(true);
  const mail = lastMail();
  expect(mail).toBeDefined();
  return mail as Mail;
}

describe("reminder alert logic", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    nextVehicleId = 1;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("STK date boundaries (reminderStkDays = 30)", () => {
    it("flags as overdue the day after expiry", async () => {
      seedSettings();
      seedVehicle({ stkValidUntil: dateInDays(-1) });

      const mail = await digestMail();
      expect(mail.text).toContain("STK: propadlá");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the reminder window edge (30 days out)", async () => {
      seedSettings();
      seedVehicle({ stkValidUntil: dateInDays(30) });

      const mail = await digestMail();
      expect(mail.text).toContain("STK: propadne");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("does not flag one day outside the reminder window (31 days out)", async () => {
      seedSettings();
      seedVehicle({ stkValidUntil: dateInDays(31) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("flags as due-soon on the expiry day itself (0 days out)", async () => {
      seedSettings();
      seedVehicle({ stkValidUntil: dateInDays(0) });

      const mail = await digestMail();
      expect(mail.text).toContain("STK: propadne");
      expect(mail.text).toContain("[blíží se]");
    });
  });

  describe("month-interval service boundaries (brakes, interval 24 months)", () => {
    it("flags as overdue one month past the interval", async () => {
      seedSettings();
      seedVehicle({ lastBrakesDate: dateInMonths(-25) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdy: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (remaining 0 months)", async () => {
      seedSettings();
      seedVehicle({ lastBrakesDate: dateInMonths(-24) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdy: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("does not flag while remaining months exceed reminderServiceDays/30", async () => {
      // reminderServiceDays 14 -> monthsThreshold = max(1, round(14/30)) = 1.
      // remaining 2 months (elapsed 22) is outside the 1-month window.
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastBrakesDate: dateInMonths(-22) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });

    it("flags as due-soon right at the reminderServiceDays/30 month threshold", async () => {
      // reminderServiceDays 14 -> monthsThreshold = 1; remaining 1 month (elapsed 23).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastBrakesDate: dateInMonths(-23) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdy: zbývá");
      expect(mail.text).toContain("[blíží se]");
    });

    it("widens the due-soon window when reminderServiceDays grows (90 -> 3 months)", async () => {
      // monthsThreshold = round(90/30) = 3. remaining 3 months (elapsed 21) flags;
      // remaining 4 months (elapsed 20) does not.
      seedSettings({ reminderServiceDays: 90 });
      seedVehicle({ lastBrakesDate: dateInMonths(-21) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdy: zbývá");

      vi.clearAllMocks();
      __store.reset();
      nextVehicleId = 1;
      seedSettings({ reminderServiceDays: 90 });
      seedVehicle({ lastBrakesDate: dateInMonths(-20) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("timing-belt date boundaries (interval 120 months, date-only)", () => {
    // timing has no last-km column, so computeVehicleAlerts drives it purely
    // off lastTimingDate; currentKm is irrelevant here.
    it("flags as overdue one month past the interval", async () => {
      seedSettings();
      seedVehicle({ lastTimingDate: dateInMonths(-121), currentKm: 200000 });

      const mail = await digestMail();
      expect(mail.text).toContain("Rozvody: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (remaining 0 months)", async () => {
      seedSettings();
      seedVehicle({ lastTimingDate: dateInMonths(-120) });

      const mail = await digestMail();
      expect(mail.text).toContain("Rozvody: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("does not flag while remaining months exceed reminderServiceDays/30", async () => {
      // reminderServiceDays 14 -> monthsThreshold 1; remaining 2 (elapsed 118).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastTimingDate: dateInMonths(-118) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("brake-fluid date boundaries (interval 24 months, date-only)", () => {
    it("flags as overdue one month past the interval", async () => {
      seedSettings();
      seedVehicle({ lastBrakeFluidDate: dateInMonths(-25) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdová kapalina: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (remaining 0 months)", async () => {
      seedSettings();
      seedVehicle({ lastBrakeFluidDate: dateInMonths(-24) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdová kapalina: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon right at the reminderServiceDays/30 threshold", async () => {
      // monthsThreshold 1; remaining 1 (elapsed 23).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastBrakeFluidDate: dateInMonths(-23) });

      const mail = await digestMail();
      expect(mail.text).toContain("Brzdová kapalina: zbývá");
      expect(mail.text).toContain("[blíží se]");
    });

    it("does not flag one month outside the threshold window", async () => {
      // monthsThreshold 1; remaining 2 (elapsed 22).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastBrakeFluidDate: dateInMonths(-22) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("km-interval service boundaries (oil, interval 15000 km, 2000 km window)", () => {
    // lastOilChangeDate stays null so only the km branch is exercised.
    it("flags as overdue one km past the interval", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeKm: 0, currentKm: 15001 });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (0 km remaining)", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeKm: 0, currentKm: 15000 });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon at the edge of the 2000 km window (2000 km remaining)", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeKm: 0, currentKm: 13000 });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: zbývá");
      expect(mail.text).toContain("[blíží se]");
    });

    it("does not flag just outside the 2000 km window (2001 km remaining)", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeKm: 0, currentKm: 12999 });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("oil date-interval boundaries (interval 12 months, date-only)", () => {
    // lastOilChangeKm stays null so only the month branch is exercised.
    it("flags as overdue one month past the interval", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeDate: dateInMonths(-13) });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (remaining 0 months)", async () => {
      seedSettings();
      seedVehicle({ lastOilChangeDate: dateInMonths(-12) });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon right at the reminderServiceDays/30 threshold", async () => {
      // monthsThreshold 1; remaining 1 month (elapsed 11).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastOilChangeDate: dateInMonths(-11) });

      const mail = await digestMail();
      expect(mail.text).toContain("Výměna oleje: zbývá");
      expect(mail.text).toContain("[blíží se]");
    });

    it("does not flag one month outside the threshold window", async () => {
      // monthsThreshold 1; remaining 2 months (elapsed 10).
      seedSettings({ reminderServiceDays: 14 });
      seedVehicle({ lastOilChangeDate: dateInMonths(-10) });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("transmission-oil applies only to automatic vehicles", () => {
    // Overdue transmission-oil data, isolated from every other service.
    const transmissionFields = {
      lastTransmissionOilKm: 0,
      currentKm: 70000, // 10000 km past the 60000 km interval
    };

    it("does not flag a manual vehicle even when overdue", async () => {
      seedSettings();
      seedVehicle({ transmission: "manual", ...transmissionFields });

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
      expect(sendMailMock).not.toHaveBeenCalled();
    });

    it("flags an automatic vehicle with the same data", async () => {
      seedSettings();
      seedVehicle({ transmission: "automatic", ...transmissionFields });

      const mail = await digestMail();
      expect(mail.text).toContain("Olej převodovky: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });
  });

  describe("transmission-oil km boundaries (automatic, interval 60000 km, 2000 km window)", () => {
    // lastTransmissionOilDate stays null so only the km branch is exercised.
    const auto = (extra: Record<string, unknown>): Record<string, unknown> => ({
      transmission: "automatic",
      lastTransmissionOilKm: 0,
      ...extra,
    });

    it("flags as overdue one km past the interval", async () => {
      seedSettings();
      seedVehicle(auto({ currentKm: 60001 }));

      const mail = await digestMail();
      expect(mail.text).toContain("Olej převodovky: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon exactly at the interval (0 km remaining)", async () => {
      seedSettings();
      seedVehicle(auto({ currentKm: 60000 }));

      const mail = await digestMail();
      expect(mail.text).toContain("Olej převodovky: zbývá");
      expect(mail.text).toContain("[blíží se]");
      expect(mail.text).not.toContain("[PO TERMÍNU]");
    });

    it("flags as due-soon at the edge of the 2000 km window (2000 km remaining)", async () => {
      seedSettings();
      seedVehicle(auto({ currentKm: 58000 }));

      const mail = await digestMail();
      expect(mail.text).toContain("Olej převodovky: zbývá");
      expect(mail.text).toContain("[blíží se]");
    });

    it("does not flag just outside the 2000 km window (2001 km remaining)", async () => {
      seedSettings();
      seedVehicle(auto({ currentKm: 57999 }));

      const result = await runReminderDigest();
      expect(result.sent).toBe(false);
    });
  });

  describe("digest contents and ordering for a mixed fleet", () => {
    it("reports correct subject counts and orders overdue vehicles first", async () => {
      seedSettings();

      // Seeded due-soon FIRST to prove ordering is by severity, not insert order.
      const dueSoon = seedVehicle({
        licensePlate: "2BB2222",
        ownerName: "Petra Dvorakova",
        stkValidUntil: dateInDays(20),
      });
      // Overdue with two alerts (STK + oil).
      const overdue = seedVehicle({
        licensePlate: "1AA1111",
        ownerName: "Jan Novak",
        stkValidUntil: dateInDays(-5),
        lastOilChangeDate: dateInMonths(-13),
      });
      // Clean vehicle — must be excluded from the digest entirely.
      seedVehicle({ licensePlate: "3CC3333" });

      const mail = await digestMail();

      // 2 vehicles need attention, 1 of them overdue.
      expect(mail.subject).toBe(
        "AutoServis: 2 vozidel vyžaduje pozornost (1 po termínu)",
      );

      // Overdue vehicle is listed before the due-soon one.
      const overdueIdx = mail.text.indexOf(overdue.licensePlate as string);
      const dueSoonIdx = mail.text.indexOf(dueSoon.licensePlate as string);
      expect(overdueIdx).toBeGreaterThanOrEqual(0);
      expect(dueSoonIdx).toBeGreaterThanOrEqual(0);
      expect(overdueIdx).toBeLessThan(dueSoonIdx);

      // Per-vehicle alert lines and owners are present.
      expect(mail.text).toContain("1AA1111 (Skoda Octavia) — Jan Novak");
      expect(mail.text).toContain("2BB2222 (Skoda Octavia) — Petra Dvorakova");
      expect(mail.text).toContain("STK: propadlá");
      expect(mail.text).toContain("Výměna oleje: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
      expect(mail.text).toContain("[blíží se]");

      // The clean vehicle never appears.
      expect(mail.text).not.toContain("3CC3333");
    });

    it("orders two overdue vehicles by descending alert count", async () => {
      seedSettings();

      // One overdue alert.
      const single = seedVehicle({
        licensePlate: "1ONE111",
        stkValidUntil: dateInDays(-2),
      });
      // Three overdue alerts (STK + oil + brakes).
      const many = seedVehicle({
        licensePlate: "3MANY33",
        stkValidUntil: dateInDays(-2),
        lastOilChangeDate: dateInMonths(-13),
        lastBrakesDate: dateInMonths(-25),
      });

      const mail = await digestMail();
      expect(mail.subject).toBe(
        "AutoServis: 2 vozidel vyžaduje pozornost (2 po termínu)",
      );

      const manyIdx = mail.text.indexOf(many.licensePlate as string);
      const singleIdx = mail.text.indexOf(single.licensePlate as string);
      expect(manyIdx).toBeLessThan(singleIdx);
    });

    it("formats and ranks timing + brake-fluid alerts end-to-end", async () => {
      seedSettings();

      // Brake-fluid due-soon only (no overdue).
      const fluid = seedVehicle({
        licensePlate: "2FLD222",
        ownerName: "Eva Mala",
        lastBrakeFluidDate: dateInMonths(-24),
      });
      // Timing overdue + brake-fluid overdue -> ranks first.
      const belt = seedVehicle({
        licensePlate: "1TIM111",
        ownerName: "Karel Velky",
        lastTimingDate: dateInMonths(-121),
        lastBrakeFluidDate: dateInMonths(-25),
      });

      const mail = await digestMail();

      expect(mail.subject).toBe(
        "AutoServis: 2 vozidel vyžaduje pozornost (1 po termínu)",
      );

      const beltIdx = mail.text.indexOf(belt.licensePlate as string);
      const fluidIdx = mail.text.indexOf(fluid.licensePlate as string);
      expect(beltIdx).toBeGreaterThanOrEqual(0);
      expect(fluidIdx).toBeGreaterThanOrEqual(0);
      expect(beltIdx).toBeLessThan(fluidIdx);

      expect(mail.text).toContain("1TIM111 (Skoda Octavia) — Karel Velky");
      expect(mail.text).toContain("Rozvody: po termínu");
      expect(mail.text).toContain("Brzdová kapalina: po termínu");
      expect(mail.text).toContain("2FLD222 (Skoda Octavia) — Eva Mala");
      expect(mail.text).toContain("Brzdová kapalina: zbývá");
      expect(mail.text).toContain("[PO TERMÍNU]");
      expect(mail.text).toContain("[blíží se]");
    });

    it("renders a transmission-oil row in the digest (automatic only)", async () => {
      seedSettings();

      // Automatic vehicle, transmission oil overdue on km.
      seedVehicle({
        licensePlate: "1AUT111",
        ownerName: "Tomas Cerny",
        transmission: "automatic",
        lastTransmissionOilKm: 0,
        currentKm: 65000,
      });
      // Manual vehicle with identical km data — its transmission oil must NOT
      // appear, so it stays out of the digest entirely.
      const manualVehicle = seedVehicle({
        licensePlate: "2MAN222",
        transmission: "manual",
        lastTransmissionOilKm: 0,
        currentKm: 65000,
      });

      const mail = await digestMail();

      expect(mail.subject).toBe(
        "AutoServis: 1 vozidel vyžaduje pozornost (1 po termínu)",
      );
      expect(mail.text).toContain("1AUT111 (Skoda Octavia) — Tomas Cerny");
      expect(mail.text).toContain("Olej převodovky: po termínu");
      expect(mail.text).toContain("[PO TERMÍNU]");
      expect(mail.text).not.toContain(manualVehicle.licensePlate as string);
    });
  });
});
