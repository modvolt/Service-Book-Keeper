import app from "./app";
import { logger } from "./lib/logger";
import {
  maybeRunScheduledDigest,
  maybeRunScheduledCustomerReminders,
} from "./lib/reminders";

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

  // Kick a tick shortly after boot, then hourly. Errors are handled inside.
  const tick = (): void => {
    void maybeRunScheduledDigest();
    void maybeRunScheduledCustomerReminders();
  };
  setTimeout(tick, 30_000);
  const timer = setInterval(tick, REMINDER_TICK_MS);
  timer.unref();
});
