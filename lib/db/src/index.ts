import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

/**
 * Cheap, non-mutating connectivity probe. Resolves when the database answers a
 * trivial query; rejects if the connection is unavailable. Used by the API
 * server's readiness check so the deployment platform waits for the DB instead
 * of cutting over to a not-ready instance.
 */
export async function pingDatabase(): Promise<void> {
  await pool.query("SELECT 1");
}

export * from "./schema";
