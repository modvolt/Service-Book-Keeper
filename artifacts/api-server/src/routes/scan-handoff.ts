import { Router, type IRouter, json } from "express";
import { ilike, and, isNull } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import { normalizeSpzOrNull } from "../lib/spz";
import {
  addScanClient,
  removeScanClient,
  scanClientCount,
  broadcastScanHandoff,
  pingScanClients,
  type ScanHandoffEvent,
} from "../lib/scan-bus";

/**
 * Live "Načtení vozu" handoff: the phone scans documents/dashboard and pushes
 * the result to the open PC session in real time. Hand-written (not codegen),
 * like the multipart photo-upload exception, because Server-Sent Events and
 * this broadcast semantics don't map onto the standard request/response codegen.
 */
const router: IRouter = Router();

// Keep proxies (Replit/Coolify) from idle-closing the SSE stream.
const PING_INTERVAL_MS = 25_000;
let pingTimer: NodeJS.Timeout | null = null;

function ensurePingTimer(): void {
  if (pingTimer) return;
  pingTimer = setInterval(() => pingScanClients(), PING_INTERVAL_MS);
  // Don't keep the process alive solely for this timer.
  pingTimer.unref?.();
}

/**
 * SSE stream. Every authenticated session of the single account subscribes
 * while the app is open. On connect we send the client its own id so it can
 * later exclude itself when it initiates a handoff.
 */
router.get("/scan/events", (req, res): void => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.write("retry: 3000\n\n");

  const id = addScanClient(res);
  res.write("event: connected\n");
  res.write(`data: ${JSON.stringify({ clientId: id })}\n\n`);
  ensurePingTimer();

  req.on("close", () => {
    removeScanClient(id);
  });
});

// Handoff payloads are small JSON; the global 1mb parser already applies, but
// declare a local one to be explicit and independent of mount order.
const smallJson = json({ limit: "64kb" });

interface HandoffBody {
  sourceClientId?: unknown;
  licensePlate?: unknown;
  vin?: unknown;
  registrationYear?: unknown;
  engineDisplacement?: unknown;
  make?: unknown;
  model?: unknown;
  odometerKm?: unknown;
  ownerName?: unknown;
  ownerIco?: unknown;
  ownerAddress?: unknown;
  color?: unknown;
  colorObserved?: unknown;
  colorMismatch?: unknown;
}

const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
const asInt = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? Math.round(v) : null;
const asIco = (v: unknown): string | null => {
  const digits = typeof v === "string" ? v.replace(/\D/g, "") : "";
  return digits.length === 8 ? digits : null;
};
const asBool = (v: unknown): boolean => v === true;

/**
 * Receive a completed scan from the phone, decide where the PC should go, and
 * broadcast the routing decision to the other open sessions. Nothing is saved
 * here — the mechanic always reviews and confirms on the PC.
 */
router.post("/scan/handoff", smallJson, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as HandoffBody;
  const sourceClientId = typeof body.sourceClientId === "string" ? body.sourceClientId : undefined;

  const licensePlate = normalizeSpzOrNull(body.licensePlate);
  const odometerKm = asInt(body.odometerKm);

  let event: ScanHandoffEvent;

  const existing = licensePlate
    ? (await db.select().from(vehiclesTable).where(and(ilike(vehiclesTable.licensePlate, licensePlate), isNull(vehiclesTable.deletedAt))))[0]
    : undefined;

  if (existing) {
    // Known vehicle -> new work order. Only carry km when it is a genuine
    // increase over the stored reading (don't overwrite with a lower/equal value).
    const km =
      odometerKm != null && (existing.currentKm == null || odometerKm > existing.currentKm)
        ? odometerKm
        : null;
    event = {
      kind: "work-order",
      vehicleId: existing.id,
      licensePlate: existing.licensePlate,
      make: existing.make,
      model: existing.model,
      prefill: { km },
    };
  } else {
    // Unknown (or unreadable) SPZ -> new vehicle form, pre-filled.
    const ownerIco = asIco(body.ownerIco);
    const color = asStr(body.color);
    const colorObserved = asStr(body.colorObserved);
    event = {
      kind: "new-vehicle",
      prefill: {
        licensePlate,
        vin: asStr(body.vin),
        registrationYear: asInt(body.registrationYear),
        engineDisplacement: asInt(body.engineDisplacement),
        make: asStr(body.make),
        model: asStr(body.model),
        odometerKm,
        ownerName: asStr(body.ownerName),
        ownerIco,
        ownerAddress: asStr(body.ownerAddress),
        ownerType: ownerIco ? "company" : "private",
        color,
        colorObserved,
        // Only relay a mismatch when both colors survived normalization.
        colorMismatch: asBool(body.colorMismatch) && color != null && colorObserved != null,
      },
    };
  }

  const delivered = broadcastScanHandoff(event, sourceClientId);
  res.json({ delivered, kind: event.kind });
});

export default router;
