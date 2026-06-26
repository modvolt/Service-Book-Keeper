// Client-side sanity checks for the AI-extracted vehicle data shown in the
// "Načtení vozu" review step. The server already nulls out values that fail its
// hard rules (VIN must be 17 chars, IČ exactly 8 digits, SPZ normalized), so
// these warnings are a softer second layer: they flag values that are present
// but look suspicious, or that are missing where the mechanic would expect one,
// so nothing is saved on blind trust. Review-first: warnings never block, they
// only prompt a double-check.

export type ScanWarningField = "vin" | "spz" | "ico" | "color" | "odometer";

export interface ScanWarning {
  field: ScanWarningField;
  message: string;
}

export interface ScanValidationInput {
  licensePlate: string | null;
  vin: string | null;
  ownerIco: string | null;
  color: string | null;
  colorObserved: string | null;
  colorMismatch: boolean;
  odometerKm: number | null;
}

// A VIN is exactly 17 chars, uppercase letters + digits, never I/O/Q.
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
// Czech SPZ after normalization is "XXX XXXX" (3 + space + 4, alphanumeric).
const SPZ_RE = /^[0-9A-Z]{3} [0-9A-Z]{4}$/;

// Czech IČO mod-11 checksum. The 8th digit is a check digit computed from the
// first 7 weighted 8..2; a value that passes the 8-digit length test can still
// be a misread, which this catches.
function isValidIcoChecksum(ico: string): boolean {
  if (!/^\d{8}$/.test(ico)) return false;
  let sum = 0;
  for (let i = 0; i < 7; i++) {
    sum += Number(ico[i]) * (8 - i);
  }
  const mod = sum % 11;
  const check = mod === 0 ? 1 : mod === 1 ? 0 : 11 - mod;
  return check === Number(ico[7]);
}

// Plausibility band for an odometer reading in km. Below/above this almost
// certainly means a misread tachometer (or the trip counter).
const ODOMETER_MIN = 1;
const ODOMETER_MAX = 2_000_000;

/**
 * Produce the list of review warnings for a scan result. Empty array means
 * nothing looked off. Order is stable (vin, spz, ico, color, odometer) so the
 * UI renders deterministically.
 */
export function validateScan(data: ScanValidationInput): ScanWarning[] {
  const warnings: ScanWarning[] = [];

  if (data.vin == null) {
    warnings.push({ field: "vin", message: "VIN se nepodařilo načíst – zkontrolujte a doplňte ručně." });
  } else if (!VIN_RE.test(data.vin)) {
    warnings.push({ field: "vin", message: "VIN má neobvyklý formát (17 znaků, bez písmen I, O, Q) – ověřte." });
  }

  if (data.licensePlate == null) {
    warnings.push({ field: "spz", message: "SPZ se nepodařilo načíst – zkontrolujte a doplňte ručně." });
  } else if (!SPZ_RE.test(data.licensePlate)) {
    warnings.push({ field: "spz", message: "SPZ má neobvyklý formát – ověřte." });
  }

  if (data.ownerIco != null && !isValidIcoChecksum(data.ownerIco)) {
    warnings.push({ field: "ico", message: "IČ neprošlo kontrolním součtem – ověřte." });
  }

  if (data.colorMismatch && data.color && data.colorObserved) {
    warnings.push({
      field: "color",
      message: `Barva v technickém průkazu (${data.color}) se liší od barvy na fotografii (${data.colorObserved}) – ověřte.`,
    });
  }

  if (data.odometerKm != null && (data.odometerKm < ODOMETER_MIN || data.odometerKm > ODOMETER_MAX)) {
    warnings.push({ field: "odometer", message: "Stav tachometru je nezvyklý – ověřte, zda nejde o chybné načtení." });
  }

  return warnings;
}

// Shown whenever scan results are reviewed: the small technical certificate
// holds personal data (owner name, address, IČ), so its processing needs a
// legal basis. This is an on-screen reminder only — the legal-basis data model
// lives elsewhere.
export const PERSONAL_DATA_NOTICE =
  "Údaje z technického průkazu (jméno, adresa a IČ vlastníka) jsou osobní údaje. Pro jejich uložení a zpracování musíte mít zákonný důvod (např. plnění smlouvy nebo souhlas vlastníka).";
