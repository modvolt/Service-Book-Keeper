import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Release smoke test for the committed database migration chain.
 *
 * Production applies migrations on container boot (`docker-entrypoint.sh` runs
 * `drizzle-kit migrate`). A broken migration file or an inconsistent journal
 * makes the deploy fail on boot and the site never comes up. This test runs the
 * SAME committed chain (the real `lib/db/drizzle` files + `meta/_journal.json`)
 * against throwaway databases so a broken upgrade is caught before it ships.
 *
 * drizzle-kit migrate and drizzle-orm's programmatic `migrate()` share identical
 * journal semantics (apply in `_journal.json` order, split on
 * `--> statement-breakpoint`, record into `drizzle.__drizzle_migrations` keyed by
 * the journal `when` timestamp), so the in-process migrator faithfully mirrors
 * the production boot path while giving us clean assertions.
 *
 * Three paths are covered:
 *  1. Fresh install  — apply the whole chain to an empty DB.
 *  2. Existing-prod upgrade — migrate to the previous release, seed
 *     representative rows, then apply the new migrations and assert the schema
 *     change + data backfill landed.
 *  3. Idempotency    — re-running migrate is a clean no-op.
 *
 * Scratch databases are created on the dev Postgres and dropped on completion.
 */

const { Pool, Client } = pg;

const DIRNAME = path.dirname(fileURLToPath(import.meta.url));
// artifacts/api-server/src/__tests__ -> repo root -> lib/db/drizzle
const REAL_MIGRATIONS_DIR = path.resolve(
  DIRNAME,
  "../../../../lib/db/drizzle",
);

// Last release tag before the invoice/payment-status refactor (0008/0009) and
// the consent-history refactor (0010). Upgrading across this boundary exercises
// real data backfills, which is the most valuable thing to regression-test.
const BASELINE_TAG = "0007_salty_spirit";

const BASE_URL = process.env.DATABASE_URL;

interface JournalEntry {
  idx: number;
  version: string;
  when: number;
  tag: string;
  breakpoints: boolean;
}
interface Journal {
  version: string;
  dialect: string;
  entries: JournalEntry[];
}

function readJournal(dir: string): Journal {
  return JSON.parse(
    fs.readFileSync(path.join(dir, "meta", "_journal.json"), "utf8"),
  ) as Journal;
}

const REAL_JOURNAL = BASE_URL ? readJournal(REAL_MIGRATIONS_DIR) : null;
const TOTAL_MIGRATIONS = REAL_JOURNAL ? REAL_JOURNAL.entries.length : 0;

function scratchUrl(dbName: string): string {
  const url = new URL(BASE_URL!);
  url.pathname = `/${dbName}`;
  return url.toString();
}

async function withAdmin<T>(fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: BASE_URL });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function createScratchDb(): Promise<string> {
  const name = `migtest_${crypto.randomBytes(6).toString("hex")}`;
  await withAdmin((c) => c.query(`CREATE DATABASE "${name}"`));
  return name;
}

async function dropScratchDb(name: string): Promise<void> {
  // WITH (FORCE) terminates any lingering connections (Postgres 13+).
  await withAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`));
}

/** Run the committed chain found in `migrationsFolder` against `dbName`. */
async function runMigrate(
  dbName: string,
  migrationsFolder: string,
): Promise<void> {
  const pool = new Pool({ connectionString: scratchUrl(dbName) });
  try {
    await migrate(drizzle(pool), { migrationsFolder });
  } finally {
    await pool.end();
  }
}

async function withDb<T>(
  dbName: string,
  fn: (pool: pg.Pool) => Promise<T>,
): Promise<T> {
  const pool = new Pool({ connectionString: scratchUrl(dbName) });
  try {
    return await fn(pool);
  } finally {
    await pool.end();
  }
}

/**
 * Build a throwaway migrations folder containing only the migrations up to and
 * including `baselineTag`, simulating the codebase at the previous release.
 */
function buildBaselineDir(baselineTag: string): {
  dir: string;
  entryCount: number;
} {
  const journal = readJournal(REAL_MIGRATIONS_DIR);
  const idx = journal.entries.findIndex((e) => e.tag === baselineTag);
  if (idx < 0) {
    throw new Error(`baseline tag ${baselineTag} not found in journal`);
  }
  const kept = journal.entries.slice(0, idx + 1);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-baseline-"));
  fs.mkdirSync(path.join(dir, "meta"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, "meta", "_journal.json"),
    JSON.stringify({ ...journal, entries: kept }, null, 2),
  );
  for (const entry of kept) {
    fs.copyFileSync(
      path.join(REAL_MIGRATIONS_DIR, `${entry.tag}.sql`),
      path.join(dir, `${entry.tag}.sql`),
    );
  }
  return { dir, entryCount: kept.length };
}

async function migrationCount(pool: pg.Pool): Promise<number> {
  const r = await pool.query<{ c: number }>(
    "SELECT count(*)::int AS c FROM drizzle.__drizzle_migrations",
  );
  return r.rows[0].c;
}

async function tableExists(pool: pg.Pool, table: string): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [table],
  );
  return (r.rowCount ?? 0) > 0;
}

async function columnExists(
  pool: pg.Pool,
  table: string,
  column: string,
): Promise<boolean> {
  const r = await pool.query(
    "SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name=$2",
    [table, column],
  );
  return (r.rowCount ?? 0) > 0;
}

const EXPECTED_TABLES = [
  "vehicles",
  "service_records",
  "work_orders",
  "photos",
  "materials_catalog",
  "work_order_materials",
  "appointments",
  "settings",
  "customer_reminder_log",
  "app_auth",
  "audit_log",
  "user_sessions",
  "loaners",
  "backups",
  "consent_history",
];

describe.skipIf(!BASE_URL)("database migration smoke test", () => {
  if (!BASE_URL) {
    console.warn(
      "[migrations-smoke] DATABASE_URL not set — skipping migration smoke test",
    );
  }

  it(
    "fresh install: applies the full committed chain cleanly and idempotently",
    async () => {
      const dbName = await createScratchDb();
      try {
        await runMigrate(dbName, REAL_MIGRATIONS_DIR);

        await withDb(dbName, async (pool) => {
          // The journal table records every committed migration.
          expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);

          // Every expected table exists.
          for (const t of EXPECTED_TABLES) {
            expect(await tableExists(pool, t), `table ${t} should exist`).toBe(
              true,
            );
          }

          // Final schema reflects the latest refactors.
          expect(await columnExists(pool, "work_orders", "payment_status")).toBe(
            true,
          );
          expect(await columnExists(pool, "work_orders", "invoice_status")).toBe(
            true,
          );
          expect(await columnExists(pool, "work_orders", "paid")).toBe(false);
          expect(await columnExists(pool, "vehicles", "legal_basis")).toBe(true);
        });

        // Re-running migrate must be a clean no-op.
        await runMigrate(dbName, REAL_MIGRATIONS_DIR);
        await withDb(dbName, async (pool) => {
          expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);
        });
      } finally {
        await dropScratchDb(dbName);
      }
    },
    120_000,
  );

  it(
    "existing-prod upgrade: applies new migrations and backfills data correctly",
    async () => {
      const dbName = await createScratchDb();
      const { dir: baselineDir, entryCount: baselineCount } =
        buildBaselineDir(BASELINE_TAG);
      try {
        // 1. Bring the DB to the previous release's schema.
        await runMigrate(dbName, baselineDir);

        await withDb(dbName, async (pool) => {
          expect(await migrationCount(pool)).toBe(baselineCount);
          // Baseline shape: `paid` exists, payment refactor + consent history not yet.
          expect(await columnExists(pool, "work_orders", "paid")).toBe(true);
          expect(await columnExists(pool, "work_orders", "payment_status")).toBe(
            false,
          );
          expect(await tableExists(pool, "consent_history")).toBe(false);

          // 2. Seed representative rows that the upcoming backfills act on.
          await pool.query(
            `INSERT INTO vehicles (license_plate, make, model, consent_given_at, consent_note)
             VALUES ('1AB1111', 'Skoda', 'Octavia', now(), 'souhlas A')`,
          );
          await pool.query(
            `INSERT INTO vehicles (license_plate, make, model)
             VALUES ('2CD2222', 'VW', 'Golf')`,
          );
          await pool.query(
            `INSERT INTO work_orders (license_plate, status, paid)
             VALUES ('1AB1111', 'completed', true)`,
          );
          await pool.query(
            `INSERT INTO work_orders (license_plate, status, paid)
             VALUES ('1AB1111', 'completed', false)`,
          );
          await pool.query(
            `INSERT INTO work_orders (license_plate, status, paid)
             VALUES ('2CD2222', 'open', false)`,
          );
        });

        // 3. Apply the new migrations on top of the seeded data.
        await runMigrate(dbName, REAL_MIGRATIONS_DIR);

        await withDb(dbName, async (pool) => {
          expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);

          // Schema change landed.
          expect(await columnExists(pool, "work_orders", "paid")).toBe(false);
          expect(await columnExists(pool, "work_orders", "payment_status")).toBe(
            true,
          );
          expect(await tableExists(pool, "consent_history")).toBe(true);

          // No data lost across the upgrade.
          const woCount = await pool.query<{ c: number }>(
            "SELECT count(*)::int AS c FROM work_orders",
          );
          expect(woCount.rows[0].c).toBe(3);
          const vCount = await pool.query<{ c: number }>(
            "SELECT count(*)::int AS c FROM vehicles",
          );
          expect(vCount.rows[0].c).toBe(2);

          // 0008 backfill: paid/status -> payment_status + invoice_status.
          const wo = await pool.query(
            "SELECT payment_status, invoice_status FROM work_orders ORDER BY id",
          );
          expect(wo.rows[0]).toMatchObject({
            payment_status: "paid",
            invoice_status: "invoiced",
          });
          expect(wo.rows[1]).toMatchObject({
            payment_status: "unpaid",
            invoice_status: "ready_to_invoice",
          });
          expect(wo.rows[2]).toMatchObject({
            payment_status: "unpaid",
            invoice_status: "not_invoiced",
          });

          // 0010 backfill: existing consent -> legal_basis + a seed history row.
          const v1 = await pool.query<{ legal_basis: string | null }>(
            "SELECT legal_basis FROM vehicles WHERE license_plate='1AB1111'",
          );
          expect(v1.rows[0].legal_basis).toBe("consent");
          const v2 = await pool.query<{ legal_basis: string | null }>(
            "SELECT legal_basis FROM vehicles WHERE license_plate='2CD2222'",
          );
          expect(v2.rows[0].legal_basis).toBeNull();

          const ch = await pool.query(
            "SELECT event, basis, note, actor FROM consent_history",
          );
          expect(ch.rowCount).toBe(1);
          expect(ch.rows[0]).toMatchObject({
            event: "migrated",
            basis: "consent",
            note: "souhlas A",
            actor: "system",
          });
        });

        // 4. Idempotency: re-running the chain changes nothing.
        await runMigrate(dbName, REAL_MIGRATIONS_DIR);
        await withDb(dbName, async (pool) => {
          expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);
          const ch = await pool.query<{ c: number }>(
            "SELECT count(*)::int AS c FROM consent_history",
          );
          expect(ch.rows[0].c).toBe(1);
        });
      } finally {
        await dropScratchDb(dbName);
        fs.rmSync(baselineDir, { recursive: true, force: true });
      }
    },
    120_000,
  );
});
