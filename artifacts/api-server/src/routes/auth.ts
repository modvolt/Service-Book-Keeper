import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import bcrypt from "bcryptjs";
import { db, appAuthTable } from "@workspace/db";
import { LoginBody, ChangePasswordBody } from "@workspace/api-zod";
import { audit } from "../lib/audit";

const router: IRouter = Router();
const ROW_ID = 1;
const BCRYPT_ROUNDS = 12;

/**
 * Ensure a password hash exists. On first run, seed it from the APP_PASSWORD
 * env var (set this as a secret). Returns the stored hash or null if not set up.
 */
async function getOrSeedHash(): Promise<string | null> {
  const [existing] = await db.select().from(appAuthTable).where(eq(appAuthTable.id, ROW_ID));
  if (existing) return existing.passwordHash;

  const seed = process.env.APP_PASSWORD;
  if (!seed) return null;

  const passwordHash = await bcrypt.hash(seed, BCRYPT_ROUNDS);
  const [created] = await db
    .insert(appAuthTable)
    .values({ id: ROW_ID, passwordHash })
    .onConflictDoNothing()
    .returning();
  if (created) return created.passwordHash;

  // A concurrent request won the insert — re-read the persisted hash so we
  // never authenticate against a locally computed, non-persisted value.
  const [row] = await db.select().from(appAuthTable).where(eq(appAuthTable.id, ROW_ID));
  return row?.passwordHash ?? null;
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

router.get("/auth/me", (req, res): void => {
  res.json({ authenticated: Boolean(req.session?.authenticated) });
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const hash = await getOrSeedHash();
  if (!hash) {
    res.status(503).json({ error: "Přihlášení není nastaveno. Nastavte proměnnou APP_PASSWORD." });
    return;
  }

  const valid = await bcrypt.compare(parsed.data.password, hash);
  if (!valid) {
    await audit("login_failed");
    res.status(401).json({ error: "Nesprávné heslo" });
    return;
  }

  // Rotate the session ID on privilege elevation to prevent session fixation,
  // then persist before reporting success.
  await regenerateSession(req);
  req.session.authenticated = true;
  await saveSession(req);
  await audit("login");
  res.json({ authenticated: true });
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

export default router;
