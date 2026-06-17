import { randomUUID } from "crypto";
import { GcsStorageDriver } from "./gcs-driver";
import { S3StorageDriver } from "./s3-driver";
import { ObjectNotFoundError, type StorageDriver, type StoredObject } from "./types";

export { ObjectNotFoundError };
export type { StoredObject };

export type StorageDriverName = "replit-gcs" | "s3";

function resolveDriverName(): StorageDriverName {
  const raw = (process.env.STORAGE_DRIVER || "replit-gcs").trim().toLowerCase();
  if (raw === "s3") return "s3";
  if (raw === "replit-gcs" || raw === "gcs" || raw === "") return "replit-gcs";
  throw new Error(`Unknown STORAGE_DRIVER "${raw}" (expected "replit-gcs" or "s3").`);
}

function createStorageDriver(): StorageDriver {
  return resolveDriverName() === "s3" ? new S3StorageDriver() : new GcsStorageDriver();
}

/**
 * Driver-agnostic facade used by route handlers. Selects the backing store via
 * the STORAGE_DRIVER env var (defaults to the Replit GCS driver for dev).
 *
 * Object paths exposed to clients/DB use the stable `/objects/<entityId>` form,
 * independent of the underlying bucket layout.
 */
export class ObjectStorageService {
  private readonly driver: StorageDriver;

  private constructor() {
    this.driver = createStorageDriver();
  }

  /** Internal — used only by the process-wide singleton accessor. */
  static createInstance(): ObjectStorageService {
    return new ObjectStorageService();
  }

  /**
   * Store an uploaded file (already buffered by the server) and return its
   * stable object path, e.g. `/objects/uploads/<uuid>`.
   */
  async uploadPrivateObject(body: Buffer, contentType: string): Promise<string> {
    const entityId = `uploads/${randomUUID()}`;
    await this.driver.putPrivateObject(entityId, body, contentType);
    return `/objects/${entityId}`;
  }

  /**
   * Store a backup blob under the stable `backups/` prefix using a caller-chosen
   * filename (unlike {@link uploadPrivateObject}, the key is deterministic so the
   * row in the `backups` table maps to a known object). Returns the
   * `/objects/backups/<filename>` path used to serve or delete it later.
   */
  async putBackupObject(filename: string, body: Buffer, contentType: string): Promise<string> {
    const entityId = `backups/${filename}`;
    await this.driver.putPrivateObject(entityId, body, contentType);
    return `/objects/${entityId}`;
  }

  /** Open a private object by its `/objects/<entityId>` path. */
  async serveObject(objectPath: string): Promise<StoredObject> {
    if (!objectPath.startsWith("/objects/")) {
      throw new ObjectNotFoundError();
    }
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId || entityId.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
      throw new ObjectNotFoundError();
    }
    return this.driver.getPrivateObject(entityId);
  }

  /** Open a public object by its relative file path, or null if absent. */
  async servePublicObject(filePath: string): Promise<StoredObject | null> {
    if (!filePath || filePath.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
      return null;
    }
    return this.driver.getPublicObject(filePath);
  }

  /**
   * Permanently delete a private object by its `/objects/<entityId>` path.
   * No-op for paths that don't resolve to a valid private object.
   */
  async deleteObject(objectPath: string): Promise<void> {
    if (!objectPath.startsWith("/objects/")) {
      return;
    }
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId || entityId.split("/").some((seg) => seg === "" || seg === "." || seg === "..")) {
      return;
    }
    await this.driver.deletePrivateObject(entityId);
  }

  /** Probe the backing store for reachability. Rejects when unreachable. */
  async healthCheck(): Promise<void> {
    await this.driver.healthCheck();
  }
}

let singleton: ObjectStorageService | null = null;

/**
 * Process-wide {@link ObjectStorageService} singleton.
 *
 * The backing driver (and its env-derived S3/GCS config + client) is created
 * exactly once and shared by every route, instead of each route building its
 * own instance. Called at module load by the routes, so missing/invalid S3 env
 * still fails fast at startup.
 */
export function getObjectStorageService(): ObjectStorageService {
  if (!singleton) {
    singleton = ObjectStorageService.createInstance();
  }
  return singleton;
}
