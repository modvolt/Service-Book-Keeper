import app from "./app";
import { logger } from "./lib/logger";
import { startReadinessProbe } from "./lib/readiness";
import { recordError } from "./lib/error-buffer";
import {
  maybeRunScheduledDigest,
  maybeRunScheduledCustomerReminders,
} from "./lib/reminders";

// Capture process-level failures into the diagnostics buffer (and the logs)
// instead of letting them vanish. We do not exit: a single instance staying up
// with a captured error is more debuggable than a crash loop.
process.on("uncaughtException", (err) => {
  recordError(err, "uncaughtException");
  logger.error({ err }, "Uncaught exception");
});
process.on("unhandledRejection", (reason) => {
  recordError(reason, "unhandledRejection");
  logger.error({ err: reason }, "Unhandled promise rejection");
});

// In-process daily reminder scheduler. Single-instance deployment (Coolify);
// the once-per-day guard lives in settings.lastStkReminderSentAt, so frequent
// ticks are safe and survive restarts.
const REMINDER_TICK_MS = 60 * 60 * 1000; // hourly

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Begin verifying dependencies (DB + storage) in the background. The server is
  // already listening so /api/healthz can answer immediately; it reports
  // unhealthy (503) until this probe confirms every dependency is reachable.
  startReadinessProbe();

  // Kick a tick shortly after boot, then hourly. Errors are handled inside.
  const tick = (): void => {
    void maybeRunScheduledDigest();
    void maybeRunScheduledCustomerReminders();
  };
  setTimeout(tick, 30_000);
  const timer = setInterval(tick, REMINDER_TICK_MS);
  timer.unref();
});
