import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import pinoHttp from "pino-http";
import router from "./routes";
import healthRouter from "./routes/health";
import authRouter from "./routes/auth";
import { sessionMiddleware } from "./lib/session";
import { requireAuth } from "./middlewares/requireAuth";
import { logger } from "./lib/logger";

const app: Express = express();

// Behind the Replit / Coolify reverse proxy — required for secure cookies and rate limiting.
app.set("trust proxy", 1);

app.use(helmet());

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

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Příliš mnoho pokusů o přihlášení. Zkuste to prosím později." },
});
app.use("/api/auth/login", loginLimiter);
app.use("/api", authRouter);

// --- Protected routes (require authenticated session) ---
app.use("/api", requireAuth, router);

// --- Global error handler ---
app.use((err: unknown, req: Request, res: Response, next: NextFunction): void => {
  req.log?.error({ err }, "Unhandled error");
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

  if (status === 413) {
    res.status(413).json({ error: "Soubor nebo požadavek je příliš velký." });
    return;
  }
  if (status === 400) {
    res.status(400).json({ error: "Neplatný požadavek." });
    return;
  }
  res.status(status >= 400 && status < 600 ? status : 500).json({ error: "Interní chyba serveru" });
});

export default app;
