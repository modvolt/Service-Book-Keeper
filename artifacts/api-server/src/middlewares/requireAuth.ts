import type { Request, Response, NextFunction } from "express";

/**
 * Gate that requires an authenticated session. Returns 401 otherwise.
 * Mounted on all /api routes except the public ones (auth + health).
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session && req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Nepřihlášen" });
}
