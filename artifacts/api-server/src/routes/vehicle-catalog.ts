import { Router, type IRouter } from "express";
import { sql, and, isNull } from "drizzle-orm";
import { db, vehiclesTable } from "@workspace/db";
import { VEHICLE_CATALOG, VEHICLE_MAKES } from "../data/vehicle-catalog";

const router: IRouter = Router();

const MAKES_CACHE_TTL_MS = 30 * 1000;
let makesCache: { at: number; values: string[] } | null = null;

async function getMergedMakes(): Promise<string[]> {
  if (makesCache && Date.now() - makesCache.at < MAKES_CACHE_TTL_MS) {
    return makesCache.values;
  }

  const dbRows = await db
    .selectDistinct({ make: vehiclesTable.make })
    .from(vehiclesTable)
    .where(isNull(vehiclesTable.deletedAt));

  const seen = new Map<string, string>(); // lowercase key → display value
  for (const m of VEHICLE_MAKES) seen.set(m.toLowerCase(), m);
  for (const r of dbRows) {
    const v = (r.make ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!seen.has(k)) seen.set(k, v);
  }

  const merged = Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "cs"));
  makesCache = { at: Date.now(), values: merged };
  return merged;
}

function foldKey(s: string): string {
  return s.trim().toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
}

async function getMergedModels(make: string): Promise<string[]> {
  const trimmed = make.trim();
  if (!trimmed) return [];
  const folded = foldKey(trimmed);

  // Find catalog entry diacritics+case-insensitively
  let catalogModels: string[] = [];
  for (const [m, models] of Object.entries(VEHICLE_CATALOG)) {
    if (foldKey(m) === folded) {
      catalogModels = models;
      break;
    }
  }

  // DB: fetch distinct makes once, filter in JS so diacritics don't matter,
  // then load models for matching make values.
  const matchingMakes = (
    await db.selectDistinct({ make: vehiclesTable.make }).from(vehiclesTable).where(isNull(vehiclesTable.deletedAt))
  )
    .map((r) => r.make)
    .filter((m): m is string => !!m && foldKey(m) === folded);

  const dbRows = matchingMakes.length
    ? await db
        .selectDistinct({ model: vehiclesTable.model })
        .from(vehiclesTable)
        .where(and(sql`${vehiclesTable.make} in ${matchingMakes}`, isNull(vehiclesTable.deletedAt)))
    : [];

  const seen = new Map<string, string>();
  for (const m of catalogModels) seen.set(m.toLowerCase(), m);
  for (const r of dbRows) {
    const v = (r.model ?? "").trim();
    if (!v) continue;
    const k = v.toLowerCase();
    if (!seen.has(k)) seen.set(k, v);
  }

  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, "cs"));
}

router.get("/vehicles/catalog/makes", async (_req, res): Promise<void> => {
  const makes = await getMergedMakes();
  res.json(makes);
});

router.get("/vehicles/catalog/models", async (req, res): Promise<void> => {
  const makeParam = typeof req.query.make === "string" ? req.query.make : "";
  if (!makeParam.trim()) { res.json([]); return; }
  const models = await getMergedModels(makeParam);
  res.json(models);
});

export default router;
