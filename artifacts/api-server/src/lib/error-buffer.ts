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

/**
 * Scrub anything that looks like a credential out of a string before it is
 * stored for the diagnostics page. The diagnostics feed is admin-gated, but
 * stack traces and error messages can still incidentally carry secrets (a
 * Postgres URL with its password, an Authorization header, an API key), and
 * those must never be persisted or shown. Best-effort, pattern-based: it does
 * not need to be exhaustive, just to catch the common shapes.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  return (
    text
      // Credentials embedded in a connection URL: scheme://user:password@host
      .replace(/(\b[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:)[^\s@/]+(@)/gi, "$1[REDACTED]$2")
      // OpenAI-style keys (sk-...) and similar long opaque tokens.
      .replace(/\bsk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
      // Authorization / Bearer headers and bare token values.
      .replace(/\b(bearer|authorization)\s+[A-Za-z0-9._~+/=-]{8,}/gi, "$1 [REDACTED]")
      // key=value / key: value pairs for sensitive-looking keys.
      .replace(
        /\b(api[_-]?key|secret|password|passwd|pwd|access[_-]?key|secret[_-]?key|token|session[_-]?id|sessionid|sid|cookie)\b(\s*[:=]\s*)(["']?)[^\s"',;}]+\3/gi,
        "$1$2[REDACTED]",
      )
  );
}

function toMessageAndStack(err: unknown): { message: string; stack: string | null } {
  if (err instanceof Error) {
    return {
      message: redactSecrets(err.message || err.name || "Unknown error"),
      stack: err.stack ? redactSecrets(err.stack) : null,
    };
  }
  if (typeof err === "string") {
    return { message: redactSecrets(err), stack: null };
  }
  try {
    return { message: redactSecrets(JSON.stringify(err)), stack: null };
  } catch {
    return { message: redactSecrets(String(err)), stack: null };
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
