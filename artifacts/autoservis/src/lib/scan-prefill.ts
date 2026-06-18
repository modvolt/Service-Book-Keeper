// Hand-off prefill payloads stashed in sessionStorage so a freshly navigated
// form (new vehicle / new work order) can pick them up once and clear them.
// Used both by the local "Načtení vozu" flow and by the live phone -> PC
// handoff (see use-scan-handoff).

const VEHICLE_KEY = "vehicleScanPrefill";
const WORKORDER_KEY = "workOrderScanPrefill";

export type VehiclePrefill = {
  licensePlate?: string | null;
  vin?: string | null;
  registrationYear?: number | null;
  engineDisplacement?: number | null;
  make?: string | null;
  model?: string | null;
  currentKm?: number | null;
  ownerName?: string | null;
  ownerIco?: string | null;
  ownerAddress?: string | null;
  ownerType?: string | null;
};

export function setVehiclePrefill(data: VehiclePrefill): void {
  try { sessionStorage.setItem(VEHICLE_KEY, JSON.stringify(data)); } catch {}
}

export function takeVehiclePrefill(): VehiclePrefill | null {
  try {
    const raw = sessionStorage.getItem(VEHICLE_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(VEHICLE_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}

export type WorkOrderPrefill = {
  km?: number | null;
};

export function setWorkOrderPrefill(data: WorkOrderPrefill): void {
  try { sessionStorage.setItem(WORKORDER_KEY, JSON.stringify(data)); } catch {}
}

export function takeWorkOrderPrefill(): WorkOrderPrefill | null {
  try {
    const raw = sessionStorage.getItem(WORKORDER_KEY);
    if (!raw) return null;
    sessionStorage.removeItem(WORKORDER_KEY);
    return JSON.parse(raw);
  } catch { return null; }
}
