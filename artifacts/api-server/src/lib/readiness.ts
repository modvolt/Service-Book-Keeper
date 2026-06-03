import { pingDatabase } from "@workspace/db";
import { getObjectStorageService } from "./storage";
import { logger } from "./logger";
import { recordError } from "./error-buffer";

export type DependencyState = "ok" | "failing";

export interface ReadinessState {
  /** Overall: true only when every dependency is reachable. */
  ready: boolean;
  database: DependencyState;
  storage: DependencyState;
  /** ISO timestamp of the last completed readiness check, or null. */
  lastCheckedAt: string | null;
}

const state: ReadinessState = {
  ready: false,
  database: "failing",
  storage: "failing",
  lastCheckedAt: null,
};

/** Current readiness snapshot (cheap, synchronous). */
export function getReadiness(): ReadinessState {
  return { ...state };
}

/**
 * Probe every dependency once, update the shared readiness state, and return it.
 * Each probe is isolated so one failing dependency doesn't mask another.
 */
export async function checkReadiness(): Promise<ReadinessState> {
  const [dbResult, storageResult] = await Promise.allSettled([
    pingDatabase(),
    getObjectStorageService().healthCheck(),
  ]);

  if (dbResult.status === "rejected") {
    recordError(dbResult.reason, "readiness: database");
  }
  if (storageResult.status === "rejected") {
    recordError(storageResult.reason, "readiness: storage");
  }

  state.database = dbResult.status === "fulfilled" ? "ok" : "failing";
  state.storage = storageResult.status === "fulfilled" ? "ok" : "failing";
  state.ready = state.database === "ok" && state.storage === "ok";
  state.lastCheckedAt = new Date().toISOString();
  return getReadiness();
}

const INITIAL_DELAY_MS = 500;
const MAX_DELAY_MS = 15_000;
const STEADY_INTERVAL_MS = 30_000;

/**
 * Run readiness checks in the background. Retries with bounded exponential
 * backoff until everything is reachable, then keeps re-checking at a steady
 * interval so the health endpoint reflects later outages too. The returned
 * timer is unref'd so it never keeps the process alive on its own.
 */
export function startReadinessProbe(): void {
  let delay = INITIAL_DELAY_MS;
  let everReady = false;

  const tick = async (): Promise<void> => {
    let current: ReadinessState;
    try {
      current = await checkReadiness();
    } catch (err) {
      recordError(err, "readiness: probe");
      current = getReadiness();
    }

    if (current.ready) {
      if (!everReady) {
        everReady = true;
        logger.info({ readiness: current }, "Dependencies ready");
      }
      delay = STEADY_INTERVAL_MS;
    } else {
      logger.warn({ readiness: current }, "Dependencies not ready yet");
      if (!everReady) {
        delay = Math.min(delay * 2, MAX_DELAY_MS);
      } else {
        delay = STEADY_INTERVAL_MS;
      }
    }

    schedule();
  };

  const schedule = (): void => {
    const timer = setTimeout(() => void tick(), delay);
    timer.unref();
  };

  schedule();
}
