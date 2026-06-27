import type { Readable } from "stream";

/**
 * Thrown when a requested object does not exist in the backing store.
 * Routes map this to a 404.
 */
export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/**
 * A readable object plus the metadata routes need to serve it.
 * `stream` is always a Node Readable so route handlers can `.pipe(res)`
 * regardless of which driver produced it.
 */
export interface StoredObject {
  stream: Readable;
  contentType: string;
  size?: number;
  visibility: "public" | "private";
}

/**
 * What a given storage driver can do beyond the baseline put/get/delete.
 * Used to gate features that not every backend supports (orphan detection
 * needs object enumeration, which some S3-compatible providers withhold).
 */
export interface StorageCapabilities {
  /** Driver can enumerate stored objects under a key prefix. */
  list: boolean;
}

/**
 * Storage backend contract. Uploads are always proxied through the server
 * (the caller hands us a Buffer), so no driver exposes presigned client-side
 * upload URLs — this keeps the deployment free of bucket CORS configuration.
 *
 * `entityId` is the object path relative to the private root, i.e. the part
 * after `/objects/` (e.g. `uploads/<uuid>`).
 */
export interface StorageDriver {
  /** Static capability declaration; integrity/full-backup features gate on it. */
  readonly capabilities: StorageCapabilities;
  putPrivateObject(entityId: string, body: Buffer, contentType: string): Promise<void>;
  /** Throws {@link ObjectNotFoundError} when the object is absent. */
  getPrivateObject(entityId: string): Promise<StoredObject>;
  /** Returns null when no public search path contains the file. */
  getPublicObject(filePath: string): Promise<StoredObject | null>;
  /** Delete a private object. Must not throw if the object is already absent. */
  deletePrivateObject(entityId: string): Promise<void>;
  /** True when the private object exists; false when absent. */
  privateObjectExists(entityId: string): Promise<boolean>;
  /**
   * Enumerate the entityIds of private objects under `prefix` (relative to the
   * private root, e.g. `uploads/`). Only valid when `capabilities.list` is true;
   * may reject if the backend denies enumeration at runtime.
   */
  listPrivateObjects(prefix: string): Promise<string[]>;
  /**
   * Cheap, non-mutating reachability probe for the backing store. Resolves when
   * the backend is reachable; rejects otherwise. Used by the readiness check.
   */
  healthCheck(): Promise<void>;
}
