export const DEFAULT_HOURLY_RATE = 720;

export function computeLaborPrice(hoursStr: string, rate = DEFAULT_HOURLY_RATE): string {
  const h = parseFloat(hoursStr);
  if (!hoursStr.trim() || Number.isNaN(h)) return "";
  return String(Math.round(h * rate));
}
