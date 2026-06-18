// Client side of the live "Načtení vozu" handoff channel.
//
// The EventSource subscription (use-scan-handoff) records this session's
// server-assigned client id here, so that when *this* device initiates a scan
// handoff it can exclude itself from the broadcast (a phone is a scanner, it
// shouldn't navigate itself).

let scanClientId: string | null = null;

export function setScanClientId(id: string | null): void {
  scanClientId = id;
}

export function getScanClientId(): string | null {
  return scanClientId;
}

export type ScanHandoffPayload = {
  licensePlate: string | null;
  vin: string | null;
  registrationYear: number | null;
  engineDisplacement: number | null;
  make: string | null;
  model: string | null;
  odometerKm: number | null;
  ownerName: string | null;
  ownerIco: string | null;
  ownerAddress: string | null;
  ownerType: string | null;
  color: string | null;
  colorObserved: string | null;
  colorMismatch: boolean;
};

export type ScanHandoffResult = {
  delivered: number;
  kind: "new-vehicle" | "work-order";
};

/**
 * Push a completed scan to the server, which decides where the other open
 * sessions (the PC) should navigate and broadcasts to them. Returns how many
 * other sessions received it (0 means no PC is connected).
 */
export async function sendScanHandoff(payload: ScanHandoffPayload): Promise<ScanHandoffResult> {
  const res = await fetch("/api/scan/handoff", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ...payload, sourceClientId: getScanClientId() }),
  });
  if (!res.ok) {
    throw new Error(`Handoff failed (${res.status})`);
  }
  return res.json() as Promise<ScanHandoffResult>;
}
