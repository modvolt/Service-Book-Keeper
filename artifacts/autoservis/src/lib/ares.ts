export type AresFields = { name: string; address: string; dic: string };

export type AresResult =
  | { ok: true; data: AresFields }
  | { ok: false; reason: "notfound" | "error" };

export function normalizeIco(ico: string): string {
  return ico.replace(/\s+/g, "");
}

export function isValidIco(ico: string): boolean {
  return /^\d{6,8}$/.test(normalizeIco(ico));
}

export async function fetchAres(ico: string): Promise<AresResult> {
  const clean = normalizeIco(ico);
  if (!isValidIco(clean)) return { ok: false, reason: "error" };
  try {
    const res = await fetch(`/api/ares/${clean}`);
    if (res.status === 404) return { ok: false, reason: "notfound" };
    if (!res.ok) return { ok: false, reason: "error" };
    const data = await res.json();
    return {
      ok: true,
      data: {
        name: data.name ?? "",
        address: data.address ?? "",
        dic: data.dic ?? "",
      },
    };
  } catch {
    return { ok: false, reason: "error" };
  }
}
