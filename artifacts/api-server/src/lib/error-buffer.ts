import { randomUUID } from "crypto";

/**
 * A single captured runtime error, kept in memory for the diagnostics page.
 */
export interface CapturedError {
  id: string;
  timestamp: string;
  message: string;
  stack: string | null;
  /** Where the error came from, e.g. "API request", "uncaughtException". */
  context: string;
}

/**
 * In-memory ring buffer of recent runtime errors. Deliberately NOT persisted:
 * the database may be the thing that's down during a deploy loop, so error
 * history lives only in this process and is lost on restart/redeploy.
 */
const MAX_ENTRIES = 200;
const entries: Array<CapturedError> = [];

function toMessageAndStack(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return { message: err.message || err.name || "Unknown error", stack: err.stack ?? null };
  }
  if (typeof err === "string") {
    return { message: err, stack: null };
  }
  try {
    return { message: JSON.stringify(err), stack: null };
  } catch {
    return { message: String(err), stack: null };
  }
}

/**
 * Record an error into the ring buffer. Never throws — capture must not be able
 * to break the very paths that call it (error handlers, process hooks).
 */
export function recordError(err: unknown, context: string): void {
  try {
    const { message, stack } = toMessageAndStack(err);
    entries.push({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      message,
      stack,
      context,
    });
    if (entries.length > MAX_ENTRIES) {
      entries.splice(0, entries.length - MAX_ENTRIES);
    }
  } catch {
    // Swallow — diagnostics capture is best-effort.
  }
}

/** Return captured errors, newest first. */
export function getCapturedErrors(): Array<CapturedError> {
  return [...entries].reverse();
}
