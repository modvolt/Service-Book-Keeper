import { describe, it, expect } from "vitest";
import { validateScan, type ScanValidationInput } from "../tp-validation";

// A clean baseline scan with everything valid — no warnings expected.
function ok(): ScanValidationInput {
  return {
    licensePlate: "1AB 2345",
    vin: "TMBJF7NE4F0123456",
    ownerIco: "27074358", // valid Czech IČO checksum (Seznam.cz)
    color: "Bílá",
    colorObserved: "Bílá",
    colorMismatch: false,
    odometerKm: 185000,
  };
}

function fieldsOf(input: ScanValidationInput): string[] {
  return validateScan(input).map((w) => w.field);
}

describe("validateScan", () => {
  it("returns no warnings for a fully valid scan", () => {
    expect(validateScan(ok())).toEqual([]);
  });

  it("warns when VIN is missing", () => {
    expect(fieldsOf({ ...ok(), vin: null })).toContain("vin");
  });

  it("warns when VIN has an invalid format (wrong length or forbidden letter)", () => {
    // Contains the forbidden letter O.
    expect(fieldsOf({ ...ok(), vin: "TMBJF7NE4O0123456" })).toContain("vin");
    // Too short.
    expect(fieldsOf({ ...ok(), vin: "TMBJF7NE4F0" })).toContain("vin");
  });

  it("warns when SPZ is missing", () => {
    expect(fieldsOf({ ...ok(), licensePlate: null })).toContain("spz");
  });

  it("warns when SPZ has an unusual format", () => {
    expect(fieldsOf({ ...ok(), licensePlate: "1AB2345" })).toContain("spz");
  });

  it("warns when IČ fails the checksum but accepts a valid one", () => {
    expect(fieldsOf({ ...ok(), ownerIco: "12345678" })).toContain("ico");
    expect(fieldsOf({ ...ok(), ownerIco: "27074358" })).not.toContain("ico");
  });

  it("does not warn on IČ when none was extracted (private owner)", () => {
    expect(fieldsOf({ ...ok(), ownerIco: null })).not.toContain("ico");
  });

  it("warns on a color mismatch and names both colors", () => {
    const warnings = validateScan({ ...ok(), color: "Bílá", colorObserved: "Stříbrná", colorMismatch: true });
    const color = warnings.find((w) => w.field === "color");
    expect(color).toBeDefined();
    expect(color?.message).toContain("Bílá");
    expect(color?.message).toContain("Stříbrná");
  });

  it("does not warn on color when there is no mismatch", () => {
    expect(fieldsOf({ ...ok(), colorMismatch: false })).not.toContain("color");
  });

  it("warns on an implausible odometer reading", () => {
    expect(fieldsOf({ ...ok(), odometerKm: 0 })).toContain("odometer");
    expect(fieldsOf({ ...ok(), odometerKm: 9_000_000 })).toContain("odometer");
  });

  it("does not warn when the odometer is absent or plausible", () => {
    expect(fieldsOf({ ...ok(), odometerKm: null })).not.toContain("odometer");
    expect(fieldsOf({ ...ok(), odometerKm: 250000 })).not.toContain("odometer");
  });

  it("keeps a stable field order across multiple warnings", () => {
    const warnings = validateScan({
      ...ok(),
      vin: null,
      licensePlate: null,
      ownerIco: "12345678",
      colorMismatch: true,
      color: "Bílá",
      colorObserved: "Černá",
      odometerKm: 0,
    });
    expect(warnings.map((w) => w.field)).toEqual(["vin", "spz", "ico", "color", "odometer"]);
  });
});
