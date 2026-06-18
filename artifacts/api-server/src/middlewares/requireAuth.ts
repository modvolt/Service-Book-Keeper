import type { Request, Response, NextFunction } from "express";

/**
 * Gate that requires an authenticated session. Returns 401 otherwise.
 * Used as the outermost auth check before role-specific gates.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (req.session && req.session.authenticated) {
    next();
    return;
  }
  res.status(401).json({ error: "Nepřihlášen" });
}

/**
 * Gate that requires the admin role. Returns 403 for scanner sessions.
 * Must be placed after requireAuth. Old sessions without a role field are
 * treated as admin for backward compatibility.
 */
export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.session?.role ?? "admin";
  if (role === "admin") {
    next();
    return;
  }
  res.status(403).json({ error: "Přístup odepřen" });
}

/**
 * Gate that passes both admin and scanner sessions. Makes the intent explicit
 * on routes that the scanner role must be able to reach (vehicle import, scan
 * handoff, etc.). Old sessions without a role field are treated as admin.
 */
export function requireScannerOrAdmin(req: Request, res: Response, next: NextFunction): void {
  const role = req.session?.role ?? "admin";
  if (role === "admin" || role === "scanner") {
    next();
    return;
  }
  res.status(403).json({ error: "Přístup odepřen" });
}
