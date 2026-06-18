import OpenAI from "openai";

let cached: OpenAI | null = null;

export function getOpenAI(): OpenAI {
  if (cached) return cached;
  if (!process.env.AI_INTEGRATIONS_OPENAI_BASE_URL) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_BASE_URL must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  if (!process.env.AI_INTEGRATIONS_OPENAI_API_KEY) {
    throw new Error(
      "AI_INTEGRATIONS_OPENAI_API_KEY must be set. Did you forget to provision the OpenAI AI integration?",
    );
  }
  cached = new OpenAI({
    apiKey: process.env.AI_INTEGRATIONS_OPENAI_API_KEY,
    baseURL: process.env.AI_INTEGRATIONS_OPENAI_BASE_URL,
  });
  return cached;
}

const DEFAULT_OPENAI_MODEL = "gpt-5.4";

/**
 * The chat model used for all completions. Configurable via the OPENAI_MODEL
 * environment variable so the deployment can switch models without a code
 * change; defaults to {@link DEFAULT_OPENAI_MODEL} (the value used in dev).
 */
export function getOpenAIModel(): string {
  return process.env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

let cachedPlatform: OpenAI | null = null;

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";

/**
 * A direct OpenAI **platform** client, independent of the Replit AI integration.
 * Configured via `OPENAI_API_KEY` (your own OpenAI key) and an optional
 * `OPENAI_BASE_URL` (defaults to the public OpenAI API). Use this for features
 * that depend on OpenAI platform capabilities not available through the Replit
 * proxy — notably stored Prompts referenced by a prompt ID.
 */
export function getPlatformOpenAI(): OpenAI {
  if (cachedPlatform) return cachedPlatform;
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY must be set to call the OpenAI platform directly (used for stored prompts).",
    );
  }
  cachedPlatform = new OpenAI({
    apiKey,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || DEFAULT_OPENAI_BASE_URL,
  });
  return cachedPlatform;
}

/**
 * The stored prompt ID (`pmpt_...`) created on the OpenAI platform, from
 * `OPENAI_PROMPT_ID`. When set, features can use the platform-managed prompt via
 * the Responses API instead of an inline prompt. Returns undefined when unset.
 */
export function getPromptId(): string | undefined {
  return process.env.OPENAI_PROMPT_ID?.trim() || undefined;
}

/**
 * Optional pinned version of the stored prompt, from `OPENAI_PROMPT_VERSION`.
 * When unset, the OpenAI platform uses the prompt's current/published version.
 */
export function getPromptVersion(): string | undefined {
  return process.env.OPENAI_PROMPT_VERSION?.trim() || undefined;
}
