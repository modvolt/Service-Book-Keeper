import { differenceInMonths, differenceInDays, parseISO, isValid, format } from "date-fns";
import { cs } from "date-fns/locale";

export type ServiceStatus = "unknown" | "ok" | "due-soon" | "overdue";

export interface ServiceStatusResult {
  status: ServiceStatus;
  agoLabel: string | null; // e.g. "před 8 měsíci · 45 000 km"
  dueLabel: string | null; // e.g. "zbývá 4 měsíce" / "po termínu 2 měsíce"
}

function fmtMonths(n: number): string {
  const abs = Math.abs(n);
  if (abs < 1) return "méně než měsíc";
  const rounded = Math.round(abs);
  if (rounded === 1) return "1 měsíc";
  if (rounded < 5) return `${rounded} měsíce`;
  return `${rounded} měsíců`;
}

function fmtKm(n: number): string {
  return `${Math.abs(n).toLocaleString("cs-CZ")} km`;
}

export function computeServiceStatus(args: {
  lastDate?: string | null;
  lastKm?: number | null;
  currentKm?: number | null;
  intervalKm?: number | null;
  intervalMonths?: number | null;
}): ServiceStatusResult {
  const { lastDate, lastKm, currentKm, intervalKm, intervalMonths } = args;

  // Build "ago" label
  let agoParts: string[] = [];
  if (lastDate) {
    const d = parseISO(lastDate);
    if (isValid(d)) {
      const months = differenceInMonths(new Date(), d);
      if (months <= 0) {
        const days = differenceInDays(new Date(), d);
        agoParts.push(days <= 1 ? "dnes" : `před ${days} dny`);
      } else {
        agoParts.push(`před ${fmtMonths(months)}`);
      }
    }
  }
  if (lastKm != null && currentKm != null && currentKm >= lastKm) {
    const drivenSince = currentKm - lastKm;
    if (drivenSince > 0) agoParts.push(`${drivenSince.toLocaleString("cs-CZ")} km od servisu`);
  } else if (lastKm != null) {
    agoParts.push(`při ${lastKm.toLocaleString("cs-CZ")} km`);
  }
  const agoLabel = agoParts.length > 0 ? agoParts.join(" · ") : null;

  // Compute due/overdue based on intervals
  let dueLabel: string | null = null;
  let status: ServiceStatus = lastDate || lastKm != null ? "ok" : "unknown";

  if (!lastDate && lastKm == null) {
    return { status: "unknown", agoLabel: null, dueLabel: null };
  }

  let monthsOver: number | null = null;
  let kmOver: number | null = null;
  let monthsRemaining: number | null = null;
  let kmRemaining: number | null = null;

  if (intervalMonths && lastDate) {
    const d = parseISO(lastDate);
    if (isValid(d)) {
      const elapsed = differenceInMonths(new Date(), d);
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
    status = "overdue";
    const parts: string[] = [];
    if (monthsOver != null) parts.push(`o ${fmtMonths(monthsOver)}`);
    if (kmOver != null) parts.push(`o ${fmtKm(kmOver)}`);
    dueLabel = `po termínu ${parts.join(" / ")}`;
  } else if (
    (monthsRemaining != null && monthsRemaining <= 2) ||
    (kmRemaining != null && kmRemaining <= 2000)
  ) {
    status = "due-soon";
    const parts: string[] = [];
    if (monthsRemaining != null) parts.push(fmtMonths(monthsRemaining));
    if (kmRemaining != null) parts.push(fmtKm(kmRemaining));
    dueLabel = `zbývá ${parts.join(" / ")}`;
  } else {
    const parts: string[] = [];
    if (monthsRemaining != null) parts.push(fmtMonths(monthsRemaining));
    if (kmRemaining != null) parts.push(fmtKm(kmRemaining));
    if (parts.length > 0) dueLabel = `zbývá ${parts.join(" / ")}`;
  }

  return { status, agoLabel, dueLabel };
}

export function formatCzDate(d?: string | null): string {
  if (!d) return "-";
  try {
    const parsed = parseISO(d);
    if (!isValid(parsed)) return d;
    return format(parsed, "d. M. yyyy", { locale: cs });
  } catch {
    return d;
  }
}
