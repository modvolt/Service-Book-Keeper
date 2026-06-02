import { db, vehiclesTable, settingsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { sendMail, isMailConfigured } from "./mailer";
import { logger } from "./logger";

type Vehicle = typeof vehiclesTable.$inferSelect;
type Settings = typeof settingsTable.$inferSelect;

type Severity = "overdue" | "due-soon";

interface VehicleAlert {
  label: string;
  severity: Severity;
  detail: string;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(target: string): number | null {
  const d = new Date(target + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((d.getTime() - today) / MS_PER_DAY);
}

function monthsElapsed(since: string): number | null {
  const d = new Date(since + "T00:00:00Z");
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  let months = (now.getUTCFullYear() - d.getUTCFullYear()) * 12 + (now.getUTCMonth() - d.getUTCMonth());
  if (now.getUTCDate() < d.getUTCDate()) months -= 1;
  return months;
}

function fmtCzDate(d: string): string {
  const parsed = new Date(d + "T00:00:00Z");
  if (Number.isNaN(parsed.getTime())) return d;
  return `${parsed.getUTCDate()}. ${parsed.getUTCMonth() + 1}. ${parsed.getUTCFullYear()}`;
}

function stkAlert(v: Vehicle, reminderStkDays: number): VehicleAlert | null {
  if (!v.stkValidUntil) return null;
  const days = daysBetween(v.stkValidUntil);
  if (days == null) return null;
  if (days < 0) {
    return { label: "STK", severity: "overdue", detail: `propadlá ${fmtCzDate(v.stkValidUntil)}` };
  }
  if (days <= reminderStkDays) {
    return { label: "STK", severity: "due-soon", detail: `propadne ${fmtCzDate(v.stkValidUntil)} (za ${days} dní)` };
  }
  return null;
}

/**
 * Date+km based service status. Mirrors the frontend computeServiceStatus
 * thresholds: overdue when interval exceeded; due-soon when within
 * `reminderServiceDays` days or 2000 km of the interval.
 */
function serviceAlert(
  label: string,
  args: {
    lastDate?: string | null;
    lastKm?: number | null;
    currentKm?: number | null;
    intervalKm?: number | null;
    intervalMonths?: number | null;
  },
  reminderServiceDays: number,
): VehicleAlert | null {
  const { lastDate, lastKm, currentKm, intervalKm, intervalMonths } = args;
  if (!lastDate && lastKm == null) return null;

  let monthsOver: number | null = null;
  let kmOver: number | null = null;
  let monthsRemaining: number | null = null;
  let kmRemaining: number | null = null;

  if (intervalMonths && lastDate) {
    const elapsed = monthsElapsed(lastDate);
    if (elapsed != null) {
      const remaining = intervalMonths - elapsed;
      if (remaining < 0) monthsOver = -remaining;
      else monthsRemaining = remaining;
    }
  }
  if (intervalKm && lastKm != null && currentKm != null) {
    const driven = currentKm - lastKm;
    if (driven >= 0) {
      const remaining = intervalKm - driven;
      if (remaining < 0) kmOver = -remaining;
      else kmRemaining = remaining;
    }
  }

  if (monthsOver != null || kmOver != null) {
    const parts: string[] = [];
    if (monthsOver != null) parts.push(`o ${monthsOver} měs.`);
    if (kmOver != null) parts.push(`o ${kmOver.toLocaleString("cs-CZ")} km`);
    return { label, severity: "overdue", detail: `po termínu ${parts.join(" / ")}` };
  }

  const monthsThreshold = Math.max(1, Math.round(reminderServiceDays / 30));
  if (
    (monthsRemaining != null && monthsRemaining <= monthsThreshold) ||
    (kmRemaining != null && kmRemaining <= 2000)
  ) {
    const parts: string[] = [];
    if (monthsRemaining != null) parts.push(`${monthsRemaining} měs.`);
    if (kmRemaining != null) parts.push(`${kmRemaining.toLocaleString("cs-CZ")} km`);
    return { label, severity: "due-soon", detail: `zbývá ${parts.join(" / ")}` };
  }
  return null;
}

function computeVehicleAlerts(v: Vehicle, settings: Settings): VehicleAlert[] {
  const out: VehicleAlert[] = [];
  const stk = stkAlert(v, settings.reminderStkDays);
  if (stk) out.push(stk);

  const oil = serviceAlert("Výměna oleje", {
    lastDate: v.lastOilChangeDate, lastKm: v.lastOilChangeKm, currentKm: v.currentKm,
    intervalKm: v.oilChangeIntervalKm ?? 15000, intervalMonths: v.oilChangeIntervalMonths ?? 12,
  }, settings.reminderServiceDays);
  if (oil) out.push(oil);

  const brakes = serviceAlert("Brzdy", {
    lastDate: v.lastBrakesDate, intervalMonths: v.brakesIntervalMonths ?? 24,
  }, settings.reminderServiceDays);
  if (brakes) out.push(brakes);

  const timing = serviceAlert("Rozvody", {
    lastDate: v.lastTimingDate, currentKm: v.currentKm,
    intervalKm: v.timingIntervalKm ?? 120000, intervalMonths: v.timingIntervalMonths ?? 120,
  }, settings.reminderServiceDays);
  if (timing) out.push(timing);

  const brakeFluid = serviceAlert("Brzdová kapalina", {
    lastDate: v.lastBrakeFluidDate, intervalMonths: v.brakeFluidIntervalMonths ?? 24,
  }, settings.reminderServiceDays);
  if (brakeFluid) out.push(brakeFluid);

  if (v.transmission === "automatic") {
    const trans = serviceAlert("Olej převodovky", {
      lastDate: v.lastTransmissionOilDate, lastKm: v.lastTransmissionOilKm, currentKm: v.currentKm,
      intervalKm: v.transmissionOilIntervalKm ?? 60000, intervalMonths: v.transmissionOilIntervalMonths ?? 48,
    }, settings.reminderServiceDays);
    if (trans) out.push(trans);
  }

  return out;
}

interface DigestRow {
  vehicle: Vehicle;
  alerts: VehicleAlert[];
  hasOverdue: boolean;
}

function buildDigest(rows: DigestRow[]): { subject: string; text: string; html: string } {
  const overdue = rows.filter((r) => r.hasOverdue).length;
  const dueSoon = rows.length - overdue;

  const subject = `AutoServis: ${rows.length} vozidel vyžaduje pozornost (${overdue} po termínu)`;

  const lines: string[] = [];
  lines.push("Souhrn upozornění na blížící se STK a servisy.");
  lines.push("");
  lines.push(`Po termínu: ${overdue} · Blíží se termín: ${dueSoon} · Celkem vozidel: ${rows.length}`);
  lines.push("");

  for (const { vehicle: v, alerts } of rows) {
    const owner = v.ownerName ? ` — ${v.ownerName}` : "";
    lines.push(`${v.licensePlate} (${v.make} ${v.model})${owner}`);
    for (const a of alerts) {
      const tag = a.severity === "overdue" ? "PO TERMÍNU" : "blíží se";
      lines.push(`  - ${a.label}: ${a.detail} [${tag}]`);
    }
    lines.push("");
  }

  const text = lines.join("\n").trim();

  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  const rowsHtml = rows
    .map(({ vehicle: v, alerts }) => {
      const owner = v.ownerName ? ` — ${esc(v.ownerName)}` : "";
      const items = alerts
        .map((a) => {
          const color = a.severity === "overdue" ? "#dc2626" : "#d97706";
          const tag = a.severity === "overdue" ? "PO TERMÍNU" : "blíží se";
          return `<li style="margin:2px 0;"><strong>${esc(a.label)}:</strong> ${esc(a.detail)} <span style="color:${color};font-weight:600;">[${tag}]</span></li>`;
        })
        .join("");
      return `<div style="margin:0 0 14px 0;"><div style="font-weight:600;">${esc(v.licensePlate)} (${esc(v.make)} ${esc(v.model)})${owner}</div><ul style="margin:4px 0 0 18px;padding:0;">${items}</ul></div>`;
    })
    .join("");

  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;">
<h2 style="margin:0 0 6px 0;">Upozornění na STK a servisy</h2>
<p style="margin:0 0 12px 0;color:#555;">Po termínu: <strong>${overdue}</strong> · Blíží se termín: <strong>${dueSoon}</strong> · Celkem vozidel: <strong>${rows.length}</strong></p>
${rowsHtml}
</div>`;

  return { subject, text, html };
}

export interface ReminderRunResult {
  sent: boolean;
  message: string;
}

/**
 * Compute the digest of vehicles needing attention and email it to the
 * configured notification address. `manual` bypasses the enabled/once-per-day
 * guards used by the scheduler (used by the in-app "test" button).
 */
export async function runReminderDigest(opts: { manual?: boolean } = {}): Promise<ReminderRunResult> {
  const manual = opts.manual ?? false;

  const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
  if (!settings) {
    return { sent: false, message: "Nastavení nebylo nalezeno." };
  }

  if (!manual && !settings.emailRemindersEnabled) {
    return { sent: false, message: "Upozornění e-mailem jsou vypnutá." };
  }

  if (!isMailConfigured()) {
    return { sent: false, message: "E-mail není nakonfigurován (chybí SMTP nastavení na serveru)." };
  }

  const recipient = (settings.notificationEmail || settings.companyEmail || "").trim();
  if (!recipient) {
    return { sent: false, message: "Není nastavena e-mailová adresa pro upozornění." };
  }

  const vehicles = await db.select().from(vehiclesTable);
  const rows: DigestRow[] = [];
  for (const v of vehicles) {
    const alerts = computeVehicleAlerts(v, settings);
    if (alerts.length === 0) continue;
    rows.push({ vehicle: v, alerts, hasOverdue: alerts.some((a) => a.severity === "overdue") });
  }

  rows.sort((a, b) => {
    if (a.hasOverdue !== b.hasOverdue) return a.hasOverdue ? -1 : 1;
    return b.alerts.length - a.alerts.length;
  });

  if (rows.length === 0) {
    return { sent: false, message: "Žádná vozidla nevyžadují pozornost — e-mail nebyl odeslán." };
  }

  const { subject, text, html } = buildDigest(rows);
  await sendMail({ to: recipient, subject, text, html });

  await db
    .update(settingsTable)
    .set({ lastStkReminderSentAt: new Date() })
    .where(eq(settingsTable.id, 1));

  logger.info({ recipient, vehicles: rows.length }, "Reminder digest sent");
  return { sent: true, message: `Souhrn odeslán na ${recipient} (${rows.length} vozidel).` };
}

/**
 * Scheduler tick: send the digest at most once per calendar day when reminders
 * are enabled. Safe to call frequently; the once-per-day guard uses
 * settings.lastStkReminderSentAt.
 */
export async function maybeRunScheduledDigest(): Promise<void> {
  try {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
    if (!settings || !settings.emailRemindersEnabled || !isMailConfigured()) return;

    if (settings.lastStkReminderSentAt) {
      const last = new Date(settings.lastStkReminderSentAt);
      const now = new Date();
      const sameDay =
        last.getFullYear() === now.getFullYear() &&
        last.getMonth() === now.getMonth() &&
        last.getDate() === now.getDate();
      if (sameDay) return;
    }

    const result = await runReminderDigest();
    if (!result.sent) {
      logger.info({ reason: result.message }, "Scheduled digest skipped");
    }
  } catch (err) {
    logger.error({ err }, "Scheduled reminder digest failed");
  }
}
