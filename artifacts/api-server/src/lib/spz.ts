// Normalize a Czech license plate (SPZ) to canonical "XXX XXXX" format
// (3 alphanumeric chars + space + 4 alphanumeric chars).
// If the input doesn't have exactly 7 alphanumeric chars, falls back to a
// trimmed, uppercased version so unusual/legacy plates aren't lost.
export function normalizeSpz(raw: string): string {
  const cleaned = raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (cleaned.length === 7) {
    return `${cleaned.slice(0, 3)} ${cleaned.slice(3)}`;
  }
  return raw.toUpperCase().trim();
}

export function normalizeSpzOrNull(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  return normalizeSpz(trimmed);
}
