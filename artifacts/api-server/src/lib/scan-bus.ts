import crypto from "node:crypto";
import type { Response } from "express";

/**
 * In-memory pub/sub for the live "Načtení vozu" scan handoff (phone -> PC).
 *
 * The app is single-user (one shared login), so a scan performed on the phone
 * can be safely broadcast to every other open session of that account. Each
 * connected SSE client is identified by a random id so the originating phone
 * can be excluded from its own broadcast (it acts purely as a scanner).
 *
 * State is process-local and intentionally ephemeral: if the server restarts,
 * clients simply reconnect via EventSource's built-in retry.
 */

export type ScanHandoffEvent =
  | {
      kind: "new-vehicle";
      prefill: {
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
      };
    }
  | {
      kind: "work-order";
      vehicleId: number;
      licensePlate: string;
      make: string | null;
      model: string | null;
      prefill: {
        km: number | null;
      };
    };

interface ScanClient {
  id: string;
  res: Response;
}

const clients = new Map<string, ScanClient>();

export function addScanClient(res: Response): string {
  const id = crypto.randomUUID();
  clients.set(id, { id, res });
  return id;
}

export function removeScanClient(id: string): void {
  clients.delete(id);
}

/** Number of clients that would receive a broadcast excluding `excludeId`. */
export function scanClientCount(excludeId?: string): number {
  if (!excludeId) return clients.size;
  return [...clients.keys()].filter((id) => id !== excludeId).length;
}

function writeEvent(res: Response, event: string, data: unknown): void {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * Broadcast a scan handoff to every connected client except the originating
 * one. Returns how many clients the event was delivered to.
 */
export function broadcastScanHandoff(event: ScanHandoffEvent, excludeId?: string): number {
  let delivered = 0;
  for (const client of clients.values()) {
    if (client.id === excludeId) continue;
    try {
      writeEvent(client.res, "handoff", event);
      delivered += 1;
    } catch {
      // A broken pipe just means the client went away; drop it.
      clients.delete(client.id);
    }
  }
  return delivered;
}

/** Send a keep-alive comment to every client to keep proxies from timing out. */
export function pingScanClients(): void {
  for (const client of clients.values()) {
    try {
      client.res.write(": ping\n\n");
    } catch {
      clients.delete(client.id);
    }
  }
}
