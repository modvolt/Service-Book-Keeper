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
