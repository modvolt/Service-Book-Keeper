import { ApiError } from "@workspace/api-client-react";

/**
 * Extract a user-facing Czech error message from any thrown value.
 *
 * Prefers the server's specific `{ error }` payload (now that the API surfaces
 * the real cause instead of a blanket "Interní chyba serveru"), then the
 * error's own message, and finally a supplied fallback.
 */
export function getApiErrorMessage(err: unknown, fallback = "Něco se pokazilo."): string {
  if (err instanceof ApiError) {
    const data = err.data;
    if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
      const serverMessage = (data as { error: string }).error.trim();
      if (serverMessage) return serverMessage;
    }
  }

  if (err instanceof Error && err.message.trim()) {
    return err.message.trim();
  }

  if (typeof err === "string" && err.trim()) {
    return err.trim();
  }

  return fallback;
}
