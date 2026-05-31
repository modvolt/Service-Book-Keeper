import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool } from "@workspace/db";
import { logger } from "./logger";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
  }
}

const secret = process.env.SESSION_SECRET;
if (!secret) {
  logger.error("SESSION_SECRET is not set — sessions are insecure. Set it before production.");
}

const PgStore = connectPgSimple(session);

export const sessionMiddleware = session({
  store: new PgStore({
    pool,
    createTableIfMissing: true,
    tableName: "user_sessions",
  }),
  secret: secret ?? "insecure-dev-secret-change-me",
  resave: false,
  saveUninitialized: false,
  name: "autoservis.sid",
  rolling: true,
  cookie: {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: 1000 * 60 * 60 * 24 * 7,
  },
});
