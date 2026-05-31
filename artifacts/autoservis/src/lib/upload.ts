export class UploadError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "UploadError";
    this.status = status;
  }
}

function defaultMessageForStatus(status: number): string {
  switch (status) {
    case 400:
      return "Neplatný soubor.";
    case 401:
      return "Nejste přihlášeni. Přihlaste se prosím znovu.";
    case 413:
      return "Soubor je příliš velký.";
    case 415:
      return "Nepodporovaný typ souboru.";
    default:
      return "Nahrávání selhalo. Zkuste to prosím znovu.";
  }
}

export interface UploadOptions<T> {
  url: string;
  field: string;
  file: File | Blob;
  onProgress?: (percent: number) => void;
  signal?: AbortSignal;
}

/**
 * Upload a single file as multipart/form-data via XHR so upload progress can be
 * reported. Resolves with the parsed JSON response; rejects with an
 * {@link UploadError} whose message is the server's `error` field when present,
 * otherwise a Czech fallback based on the HTTP status.
 */
export function uploadFileWithProgress<T = unknown>({
  url,
  field,
  file,
  onProgress,
  signal,
}: UploadOptions<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const form = new FormData();
    form.append(field, file);

    xhr.open("POST", url);
    xhr.withCredentials = true;

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.min(100, Math.round((e.loaded / e.total) * 100)));
        }
      };
    }

    xhr.onload = () => {
      const contentType = xhr.getResponseHeader("content-type") || "";
      let body: unknown = null;
      if (contentType.includes("application/json") && xhr.responseText) {
        try {
          body = JSON.parse(xhr.responseText);
        } catch {
          body = null;
        }
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const serverMessage =
        body && typeof body === "object" && typeof (body as { error?: unknown }).error === "string"
          ? (body as { error: string }).error
          : null;
      reject(new UploadError(serverMessage || defaultMessageForStatus(xhr.status), xhr.status));
    };

    xhr.onerror = () => reject(new UploadError("Síťová chyba při nahrávání.", 0));
    xhr.ontimeout = () => reject(new UploadError("Vypršel čas nahrávání.", 0));
    xhr.onabort = () => reject(new UploadError("Nahrávání bylo zrušeno.", 0));

    if (signal) {
      if (signal.aborted) {
        xhr.abort();
        return;
      }
      signal.addEventListener("abort", () => xhr.abort(), { once: true });
    }

    xhr.send(form);
  });
}
