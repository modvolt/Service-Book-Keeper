import path from "node:path";
import fs from "node:fs";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import healthRouter from "./routes/health";
import diagnosticsRouter from "./routes/diagnostics";
import authRouter from "./routes/auth";
import { sessionMiddleware } from "./lib/session";
import { requireAuth } from "./middlewares/requireAuth";
import { logger } from "./lib/logger";
import { recordError } from "./lib/error-buffer";

const app: Express = express();

// Behind the Replit / Coolify reverse proxy — required for secure cookies and rate limiting.
app.set("trust proxy", 1);

// Content-Security-Policy: extend helmet's safe defaults so the single-origin
// SPA served by this server in production works without loosening script-src.
// - img-src adds blob: for client-side photo previews (URL.createObjectURL).
// - worker-src adds blob: for the PWA service worker / workbox runtime.
// Google Fonts (style + font fetches) are already covered by the default
// style-src/font-src "https:" allowance. In dev the SPA is served by Vite and
// this CSP only applies to /api responses, so it is inert there.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        ...helmet.contentSecurityPolicy.getDefaultDirectives(),
        "img-src": ["'self'", "data:", "blob:"],
        "worker-src": ["'self'", "blob:"],
      },
    },
  }),
);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// CORS: same-origin app served through the proxy. Restrict to configured origins
// in production via ALLOWED_ORIGINS (comma-separated). In dev, reflect the origin.
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);

// Small global body limit to avoid pre-auth resource amplification. The only
// endpoint that needs large payloads (TP-import, base64 photos) installs its
// own larger parser locally, after the auth gate.
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true, limit: "1mb" }));

app.use(sessionMiddleware);

// --- Public routes (no auth) ---
app.use("/api", healthRouter);
// Diagnostics page + error feed. Public by deliberate user choice so it stays
// reachable at the deployed URL without a login.
app.use("/api", diagnosticsRouter);

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Příliš mnoho pokusů o přihlášení. Zkuste to prosím později." },
});
app.use("/api/auth/login", loginLimiter);

const passwordResetLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Příliš mnoho požadavků. Zkuste to prosím později." },
});
app.use("/api/auth/forgot-password", passwordResetLimiter);
app.use("/api/auth/reset-password", passwordResetLimiter);
app.use("/api", authRouter);

// --- Protected routes (require authenticated session) ---
app.use("/api", requireAuth, router);

// --- Static frontend (production single-container deploy) ---
// In production the built SPA is served by this same server so the whole app
// runs from one origin (no separate static host, no CORS). In dev the frontend
// is served by Vite, so this block stays inert unless STATIC_DIR is set.
// STATIC_DIR overrides the location; otherwise it defaults to the autoservis
// build output resolved relative to this bundle (artifacts/api-server/dist ->
// artifacts/autoservis/dist/public).
const staticDir =
  process.env.STATIC_DIR?.trim() ||
  (process.env.NODE_ENV === "production"
    ? path.resolve(__dirname, "../../autoservis/dist/public")
    : null);

if (staticDir) {
  if (!fs.existsSync(path.join(staticDir, "index.html"))) {
    logger.warn({ staticDir }, "STATIC_DIR has no index.html; SPA will not be served");
  }
  // Serve hashed assets with long-lived caching; index.html stays uncached so a
  // new deploy is picked up immediately (the service worker handles the rest).
  app.use(
    express.static(staticDir, {
      index: false,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // SPA fallback: any non-/api GET that didn't match a static file returns
  // index.html so client-side (wouter) routing works on hard refresh.
  app.get(/^\/(?!api(?:\/|$)).*/, (req: Request, res: Response, next: NextFunction): void => {
    if (req.method !== "GET") {
      next();
      return;
    }
    res.sendFile(path.join(staticDir, "index.html"));
  });
}

// --- Global error handler ---
app.use((err: unknown, req: Request, res: Response, next: NextFunction): void => {
  req.log?.error({ err }, "Unhandled error");
  recordError(err, `API ${req.method} ${req.originalUrl?.split("?")[0] ?? req.url}`);
  if (res.headersSent) {
    next(err);
    return;
  }

  const status =
    typeof err === "object" && err !== null && "status" in err && typeof (err as { status: unknown }).status === "number"
      ? (err as { status: number }).status
      : typeof err === "object" && err !== null && "statusCode" in err && typeof (err as { statusCode: unknown }).statusCode === "number"
        ? (err as { statusCode: number }).statusCode
        : 500;

  // The specific error message, when we have a non-empty string one. Errors we
  // throw ourselves carry Czech messages; this preserves them verbatim.
  const specificMessage =
    typeof err === "object" && err !== null && typeof (err as { message?: unknown }).message === "string"
      ? (err as { message: string }).message.trim()
      : "";

  const normalizedStatus = status >= 400 && status < 600 ? status : 500;

  // Keep clear Czech wording for the two situations the user always sees.
  if (normalizedStatus === 413) {
    res.status(413).json({ error: "Soubor nebo požadavek je příliš velký." });
    return;
  }
  if (normalizedStatus === 400) {
    res.status(400).json({ error: specificMessage || "Neplatný požadavek." });
    return;
  }

  // For everything else (incl. 500s), surface the real cause instead of hiding
  // it behind a blanket message — per the user's explicit diagnostics request.
  res.status(normalizedStatus).json({ error: specificMessage || "Interní chyba serveru" });
});

export default app;
