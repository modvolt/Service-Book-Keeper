import nodemailer, { type Transporter } from "nodemailer";
import { logger } from "./logger";

/**
 * Env-driven SMTP configuration. Mirrors the storage-driver pattern: all
 * settings come from the environment (nothing hardcoded) so the same build
 * runs against Gmail SMTP in production and any SMTP server elsewhere.
 *
 * Required when email features are used:
 *   SMTP_HOST   - SMTP server hostname (e.g. smtp.gmail.com)
 *   SMTP_USER   - SMTP username (e.g. the Gmail address)
 *   SMTP_PASS   - SMTP password (e.g. a Gmail app password)
 * Optional:
 *   SMTP_PORT   - default 587
 *   SMTP_SECURE - "true" for implicit TLS (port 465); default false (STARTTLS)
 *   MAIL_FROM   - From header; defaults to SMTP_USER
 */
export interface MailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

function parseBool(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/**
 * Read and validate the SMTP configuration from the environment. Returns null
 * when the required variables are not all present (email features then stay
 * inert instead of crashing the server).
 */
export function readMailConfig(): MailConfig | null {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS;

  if (!host || !user || !pass) return null;

  const portRaw = process.env.SMTP_PORT?.trim();
  const port = portRaw ? Number(portRaw) : 587;
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid SMTP_PORT value: "${portRaw}"`);
  }

  return {
    host,
    port,
    secure: parseBool(process.env.SMTP_SECURE),
    user,
    pass,
    from: process.env.MAIL_FROM?.trim() || user,
  };
}

/** Whether SMTP is fully configured and email can be sent. */
export function isMailConfigured(): boolean {
  return readMailConfig() !== null;
}

let transporter: Transporter | null = null;
let cachedFrom: string | null = null;

function getTransporter(): { transporter: Transporter; from: string } {
  const config = readMailConfig();
  if (!config) {
    throw new Error(
      "E-mail není nakonfigurován. Nastavte SMTP_HOST, SMTP_USER a SMTP_PASS.",
    );
  }

  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.host,
      port: config.port,
      secure: config.secure,
      auth: { user: config.user, pass: config.pass },
    });
    cachedFrom = config.from;
  }

  return { transporter, from: cachedFrom ?? config.from };
}

/**
 * Send a single email through the configured SMTP transport. Throws when SMTP
 * is not configured or the send fails. Never logs message bodies or credentials.
 */
export async function sendMail(message: MailMessage): Promise<void> {
  const { transporter: tx, from } = getTransporter();
  try {
    await tx.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  } catch (err) {
    logger.error({ err, to: message.to }, "Failed to send email");
    throw err;
  }
}
