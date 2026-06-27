import { describe, it, expect } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);

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
// artifacts/api-server/src/__tests__ -> repo root
const REPO_ROOT = path.resolve(DIRNAME, "../../../..");
// repo root -> lib/db/drizzle
const REAL_MIGRATIONS_DIR = path.join(REPO_ROOT, "lib/db/drizzle");
// The exact drizzle-kit binary `pnpm --filter @workspace/db run migrate` runs.
const DRIZZLE_KIT_BIN = path.join(
  REPO_ROOT,
  "lib/db/node_modules/.bin/drizzle-kit",
);
const SCHEMA_PATH = path.join(REPO_ROOT, "lib/db/src/schema/index.ts");
const CLI_AVAILABLE = fs.existsSync(DRIZZLE_KIT_BIN);

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

/**
 * Run the ACTUAL `drizzle-kit migrate` CLI against `dbName`, exactly the way the
 * production container boots (`docker-entrypoint.sh` ->
 * `pnpm --filter @workspace/db run migrate` -> `drizzle-kit migrate`).
 *
 * Mirrors `lib/db/drizzle.config.ts` but points `dbCredentials.url` at the
 * scratch DB. `out` is the real committed migrations folder so the CLI applies
 * the same chain. The config is written as a plain default-export object (no
 * `drizzle-kit` import) so it loads regardless of the temp file's location.
 *
 * The CLI is spawned with cwd `/`: drizzle-kit prepends `./` to the configured
 * `out`, and an absolute `out` only collapses cleanly (`.//abs` -> `/abs`) from
 * the filesystem root (see the drizzle-kit gotcha in replit.md). Returns the
 * captured stdout so callers can assert on the CLI's own output.
 */
async function runMigrateCli(dbName: string): Promise<string> {
  const configPath = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "drizzle-cli-cfg-")),
    "drizzle.config.ts",
  );
  fs.writeFileSync(
    configPath,
    `export default {\n` +
      `  schema: ${JSON.stringify(SCHEMA_PATH)},\n` +
      `  out: ${JSON.stringify(REAL_MIGRATIONS_DIR)},\n` +
      `  dialect: "postgresql",\n` +
      `  dbCredentials: { url: ${JSON.stringify(scratchUrl(dbName))} },\n` +
      `};\n`,
  );
  try {
    const { stdout, stderr } = await execFileAsync(
      DRIZZLE_KIT_BIN,
      ["migrate", "--config", configPath],
      { cwd: "/", encoding: "utf8" },
    );
    return `${stdout}\n${stderr}`;
  } finally {
    fs.rmSync(path.dirname(configPath), { recursive: true, force: true });
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

/**
 * Production boot path: run the REAL `drizzle-kit migrate` CLI, not drizzle-orm's
 * in-process `migrate()`. The two share journal semantics today, so the
 * in-process suite above is a faithful mirror — but a future drizzle-kit version
 * bump, a config-only setting, or a CLI-specific quirk could make the container's
 * boot command behave differently and slip past the in-process test. This block
 * exercises the exact binary + config form the container runs on startup.
 */
describe.skipIf(!BASE_URL || !CLI_AVAILABLE)(
  "database migration smoke test (drizzle-kit migrate CLI / prod boot path)",
  () => {
    if (BASE_URL && !CLI_AVAILABLE) {
      console.warn(
        `[migrations-smoke] drizzle-kit binary not found at ${DRIZZLE_KIT_BIN} — skipping CLI migration smoke test`,
      );
    }

    it(
      "fresh install: the real CLI applies the full chain cleanly and is a no-op on re-run",
      async () => {
        const dbName = await createScratchDb();
        try {
          // First boot: the CLI applies the whole committed chain.
          const out = await runMigrateCli(dbName);
          expect(out).toContain("migrations applied successfully");

          await withDb(dbName, async (pool) => {
            // The journal table records every committed migration, keyed the
            // same way as the in-process migrator.
            expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);

            // Every expected table exists after the CLI run.
            for (const t of EXPECTED_TABLES) {
              expect(
                await tableExists(pool, t),
                `table ${t} should exist`,
              ).toBe(true);
            }

            // Final schema reflects the latest refactors.
            expect(
              await columnExists(pool, "work_orders", "payment_status"),
            ).toBe(true);
            expect(await columnExists(pool, "work_orders", "paid")).toBe(false);
            expect(await columnExists(pool, "vehicles", "legal_basis")).toBe(
              true,
            );
          });

          // Second boot (e.g. a container restart with no new migrations) must
          // be a clean no-op: no error, no extra journal rows.
          await runMigrateCli(dbName);
          await withDb(dbName, async (pool) => {
            expect(await migrationCount(pool)).toBe(TOTAL_MIGRATIONS);
          });
        } finally {
          await dropScratchDb(dbName);
        }
      },
      120_000,
    );
  },
);
