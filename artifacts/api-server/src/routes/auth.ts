import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { db, appAuthTable, settingsTable } from "@workspace/db";
import { LoginBody, ChangePasswordBody, ForgotPasswordBody, ResetPasswordBody, SetScannerPasswordBody, ChangeScannerPasswordBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";
import { sendMail, isMailConfigured } from "../lib/mailer";
import { logger } from "../lib/logger";

const router: IRouter = Router();
const ROW_ID = 1;         // admin account row
const SCANNER_ROW_ID = 2; // scanner account row
const BCRYPT_ROUNDS = 12;
// Sentinel value stored when the admin explicitly disables the scanner account.
// Bcrypt.compare against this sentinel always returns false, and login treats it
// as "no scanner account". Using a sentinel instead of a row delete prevents
// SCANNER_PASSWORD from re-seeding the account on the next login attempt.
const SCANNER_DISABLED = "__disabled__";
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Resolve the trusted public base URL for password-reset links. Never derived
 * from the request Host header (which is attacker-controllable and could be
 * used to send a poisoned reset link). Uses APP_URL when set; in development
 * falls back to the Replit-provided dev domain. Returns null when no trusted
 * origin is available, in which case no reset email is sent.
 */
function resolveAppBaseUrl(): string | null {
  const explicit = process.env.APP_URL?.trim();
  if (explicit) return explicit.replace(/\/+$/, "");

  if (process.env.NODE_ENV !== "production") {
    const devDomain = process.env.REPLIT_DEV_DOMAIN?.trim();
    if (devDomain) return `https://${devDomain}`;
  }

  return null;
}

/**
 * Ensure a password hash exists for the given row ID. On first run, seeds it
 * from the supplied env var (set it as a secret). Returns the stored hash or
 * null if neither the row exists nor the env var is set.
 *
 * The fake-db used in tests ignores `.where()` predicates and returns ALL rows,
 * so we filter by id in JS after the select to stay hermetic in tests.
 */
async function getOrSeedAuthRow(
  rowId: number,
  envVar: string,
  role: string,
): Promise<string | null> {
  const rows = await db.select().from(appAuthTable).where(eq(appAuthTable.id, rowId));
  const existing = rows.find((r) => r.id === rowId);
  if (existing) return existing.passwordHash;

  const seed = process.env[envVar];
  if (!seed) return null;

  const passwordHash = await bcrypt.hash(seed, BCRYPT_ROUNDS);
  const [created] = await db
    .insert(appAuthTable)
    .values({ id: rowId, passwordHash, role })
    .onConflictDoNothing()
    .returning();
  if (created) return created.passwordHash;

  // A concurrent request won the insert — re-read the persisted hash so we
  // never authenticate against a locally computed, non-persisted value.
  const rows2 = await db.select().from(appAuthTable).where(eq(appAuthTable.id, rowId));
  return rows2.find((r) => r.id === rowId)?.passwordHash ?? null;
}

/** Get-or-seed the admin password hash (row id 1, APP_PASSWORD env). */
const getOrSeedHash = () => getOrSeedAuthRow(ROW_ID, "APP_PASSWORD", "admin");

/**
 * Get-or-seed the scanner password hash (row id 2, SCANNER_PASSWORD env).
 * Returns null if the scanner account is absent or was explicitly disabled by
 * the admin (sentinel value). Using a sentinel instead of row deletion prevents
 * the SCANNER_PASSWORD env var from silently re-enabling the account after an
 * admin has turned it off.
 */
async function getOrSeedScannerHash(): Promise<string | null> {
  const hash = await getOrSeedAuthRow(SCANNER_ROW_ID, "SCANNER_PASSWORD", "scanner");
  return hash === SCANNER_DISABLED ? null : hash;
}

function regenerateSession(req: { session: { regenerate: (cb: (err: unknown) => void) => void } }): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
}

function saveSession(req: { session: { save: (cb: (err: unknown) => void) => void } }): Promise<void> {
  return new Promise((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });
}

router.get("/auth/me", async (req, res): Promise<void> => {
  const authenticated = Boolean(req.session?.authenticated);
  // Inform the client whether a live (non-sentinel) scanner account exists so
  // the admin settings UI can show current state without an extra round-trip.
  const scannerRows = await db.select().from(appAuthTable).where(eq(appAuthTable.id, SCANNER_ROW_ID));
  const scannerRow = scannerRows.find((r) => r.id === SCANNER_ROW_ID);
  const scannerEnabled = !!scannerRow && scannerRow.passwordHash !== SCANNER_DISABLED;
  res.json({
    authenticated,
    role: authenticated ? (req.session.role ?? "admin") : null,
    scannerEnabled,
  });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  // Ensure admin row is seeded; 503 if it has never been set up.
  const adminHash = await getOrSeedHash();
  if (!adminHash) {
    res.status(503).json({ error: "Přihlášení není nastaveno. Nastavte proměnnou APP_PASSWORD." });
    return;
  }

  // Seed scanner row if SCANNER_PASSWORD is configured (idempotent).
  const scannerHash = await getOrSeedScannerHash();

  // Try admin password first, then scanner. Rotate session on success to
  // prevent session fixation.
  if (await bcrypt.compare(parsed.data.password, adminHash)) {
    await regenerateSession(req);
    req.session.authenticated = true;
    req.session.role = "admin";
    await saveSession(req);
    await audit("login");
    res.json({ authenticated: true, role: "admin" });
    return;
  }

  if (scannerHash && await bcrypt.compare(parsed.data.password, scannerHash)) {
    await regenerateSession(req);
    req.session.authenticated = true;
    req.session.role = "scanner";
    await saveSession(req);
    await audit("login");
    res.json({ authenticated: true, role: "scanner" });
    return;
  }

  await audit("login_failed");
  res.status(401).json({ error: "Nesprávné heslo" });
});

router.post("/auth/logout", (req, res): void => {
  const wasAuthed = Boolean(req.session?.authenticated);
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Session destroy failed");
      res.status(500).json({ error: "Odhlášení se nezdařilo" });
      return;
    }
    res.clearCookie("autoservis.sid");
    res.status(204).end();
    if (wasAuthed) void audit("logout");
  });
});

router.post("/auth/change-password", async (req, res): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Nepřihlášen" });
    return;
  }

  // Only the admin account can change its password via this endpoint.
  const role = req.session.role ?? "admin";
  if (role !== "admin") {
    res.status(403).json({ error: "Tato akce je dostupná pouze pro administrátora." });
    return;
  }

  const parsed = ChangePasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const hash = await getOrSeedHash();
  if (!hash) {
    res.status(503).json({ error: "Přihlášení není nastaveno." });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, hash);
  if (!valid) {
    res.status(400).json({ error: "Současné heslo je nesprávné" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await db
    .insert(appAuthTable)
    .values({ id: ROW_ID, passwordHash, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appAuthTable.id, set: { passwordHash, updatedAt: new Date() } });

  await audit("password_changed");
  res.status(204).end();
});

/**
 * Change the scanner account's own password. Scanner role only.
 * Requires the current password to be provided (self-service, not a forced reset).
 */
router.post("/auth/change-scanner-password", async (req, res): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Nepřihlášen" });
    return;
  }
  const role = req.session.role ?? "admin";
  if (role !== "scanner") {
    res.status(403).json({ error: "Tato akce je dostupná pouze pro účet skeneru." });
    return;
  }

  const parsed = ChangeScannerPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const hash = await getOrSeedScannerHash();
  if (!hash) {
    res.status(503).json({ error: "Účet skeneru není nastaven." });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.currentPassword, hash);
  if (!valid) {
    res.status(400).json({ error: "Současné heslo je nesprávné." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await db
    .insert(appAuthTable)
    .values({ id: SCANNER_ROW_ID, passwordHash, role: "scanner", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appAuthTable.id,
      set: { passwordHash, updatedAt: new Date() },
    });

  await audit("scanner_password_changed");
  res.status(204).end();
});

/**
 * Set or change the scanner account password. Admin only.
 * Creates the scanner row (id 2) if it doesn't exist yet.
 */
router.post("/auth/set-scanner-password", async (req, res): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Nepřihlášen" });
    return;
  }
  const role = req.session.role ?? "admin";
  if (role !== "admin") {
    res.status(403).json({ error: "Tato akce je dostupná pouze pro administrátora." });
    return;
  }

  const parsed = SetScannerPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await db
    .insert(appAuthTable)
    .values({ id: SCANNER_ROW_ID, passwordHash, role: "scanner", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appAuthTable.id,
      set: { passwordHash, updatedAt: new Date() },
    });

  await audit("scanner_password_changed");
  res.status(204).end();
});

/**
 * Disable the scanner account. Admin only.
 * Writes the SCANNER_DISABLED sentinel instead of deleting the row so that the
 * SCANNER_PASSWORD env var cannot silently re-seed the account on the next
 * login attempt. Login treats the sentinel as "no scanner account".
 */
router.delete("/auth/scanner-password", async (req, res): Promise<void> => {
  if (!req.session?.authenticated) {
    res.status(401).json({ error: "Nepřihlášen" });
    return;
  }
  const role = req.session.role ?? "admin";
  if (role !== "admin") {
    res.status(403).json({ error: "Tato akce je dostupná pouze pro administrátora." });
    return;
  }

  await db
    .insert(appAuthTable)
    .values({ id: SCANNER_ROW_ID, passwordHash: SCANNER_DISABLED, role: "scanner", updatedAt: new Date() })
    .onConflictDoUpdate({
      target: appAuthTable.id,
      set: { passwordHash: SCANNER_DISABLED, updatedAt: new Date() },
    });

  await audit("scanner_password_deleted");
  res.status(204).end();
});

/**
 * Request a password-reset link. Always responds 200 with a generic message so
 * an attacker cannot learn whether a given address is the configured one.
 * The token is stored only as a SHA-256 hash with a short TTL.
 */
router.post("/auth/forgot-password", async (req, res): Promise<void> => {
  const generic = { message: "Pokud e-mail odpovídá nastavené adrese, byl odeslán odkaz pro obnovu hesla." };

  const parsed = ForgotPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.json(generic);
    return;
  }
  const email = parsed.data.email.trim().toLowerCase();

  try {
    const [settings] = await db.select().from(settingsTable).where(eq(settingsTable.id, 1));
    const configured = (settings?.notificationEmail || settings?.companyEmail || "").trim().toLowerCase();

    if (!configured || configured !== email || !isMailConfigured()) {
      res.json(generic);
      return;
    }

    // Build the link only from a trusted origin; never from the request Host.
    const base = resolveAppBaseUrl();
    if (!base) {
      logger.error("Forgot-password: no trusted base URL (set APP_URL); no email sent");
      res.json(generic);
      return;
    }

    // Ensure the auth row exists so the token has somewhere to live. If the
    // app has never been set up (no row and no APP_PASSWORD), there is nothing
    // to reset — bail without sending a token that could never be applied.
    const existingHash = await getOrSeedHash();
    if (!existingHash) {
      res.json(generic);
      return;
    }

    const token = crypto.randomBytes(32).toString("hex");
    const resetTokenHash = hashToken(token);
    const resetTokenExpiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

    await db
      .update(appAuthTable)
      .set({ resetTokenHash, resetTokenExpiresAt })
      .where(eq(appAuthTable.id, ROW_ID));

    const link = `${base}/reset-hesla?token=${token}`;

    await sendMail({
      to: configured,
      subject: "AutoServis: obnova hesla",
      text:
        `Byla vyžádána obnova hesla do aplikace AutoServis.\n\n` +
        `Pro nastavení nového hesla otevřete tento odkaz (platí 1 hodinu):\n${link}\n\n` +
        `Pokud jste o obnovu nežádali, tento e-mail ignorujte.`,
      html:
        `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#111;">` +
        `<p>Byla vyžádána obnova hesla do aplikace AutoServis.</p>` +
        `<p>Pro nastavení nového hesla klikněte na tlačítko (odkaz platí 1 hodinu):</p>` +
        `<p><a href="${link}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Nastavit nové heslo</a></p>` +
        `<p style="color:#555;">Pokud jste o obnovu nežádali, tento e-mail ignorujte.</p>` +
        `</div>`,
    });

    await audit("password_reset_requested");
  } catch (err) {
    logger.error({ err }, "Forgot-password failed");
  }

  res.json(generic);
});

/**
 * Complete a password reset using a valid, unexpired token. The token is
 * single-use: it is cleared on success.
 */
router.post("/auth/reset-password", async (req, res): Promise<void> => {
  const parsed = ResetPasswordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const rows = await db.select().from(appAuthTable).where(eq(appAuthTable.id, ROW_ID));
  const row = rows.find((r) => r.id === ROW_ID);
  if (!row || !row.resetTokenHash || !row.resetTokenExpiresAt) {
    res.status(400).json({ error: "Odkaz pro obnovu je neplatný nebo vypršel." });
    return;
  }

  if (new Date(row.resetTokenExpiresAt).getTime() < Date.now()) {
    res.status(400).json({ error: "Odkaz pro obnovu je neplatný nebo vypršel." });
    return;
  }

  const provided = hashToken(parsed.data.token);
  const expected = row.resetTokenHash;
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  const valid = providedBuf.length === expectedBuf.length && crypto.timingSafeEqual(providedBuf, expectedBuf);
  if (!valid) {
    res.status(400).json({ error: "Odkaz pro obnovu je neplatný nebo vypršel." });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.data.newPassword, BCRYPT_ROUNDS);
  await db
    .update(appAuthTable)
    .set({ passwordHash, resetTokenHash: null, resetTokenExpiresAt: null, updatedAt: new Date() })
    .where(eq(appAuthTable.id, ROW_ID));

  await audit("password_reset");
  res.status(204).end();
});

export default router;
