export const DEFAULT_HOURLY_RATE = 720;

export function computeLaborPrice(hoursStr: string, rate = DEFAULT_HOURLY_RATE): string {
  const normalized = hoursStr.replace(",", ".");
  const h = parseFloat(normalized);
  if (!normalized.trim() || Number.isNaN(h)) return "";
  return String(Math.round(h * rate));
}

// Decide whether an already-saved labor price should be treated as a manual
// override (kept as-is when the user edits hours) or as an auto-computed value
// (recalculated from hours × rate). It is manual only when a price exists and
// does NOT match hours × rate; a price equal to hours × rate is auto-computed,
// so editing hours must recompute it (and the order total) instead of freezing.
export function isManualLaborPrice(
  hoursStr: string | null | undefined,
  price: number | null | undefined,
  rate = DEFAULT_HOURLY_RATE,
): boolean {
  if (price == null) return false;
  const computed = computeLaborPrice(hoursStr ?? "", rate);
  if (computed === "") return true;
  return parseInt(computed, 10) !== price;
}
