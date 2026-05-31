import { Storage, type File } from "@google-cloud/storage";
import { getObjectAclPolicy } from "../objectAcl";
import { ObjectNotFoundError, type StorageDriver, type StoredObject } from "./types";

const REPLIT_SIDECAR_ENDPOINT = "http://127.0.0.1:1106";

const objectStorageClient = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${REPLIT_SIDECAR_ENDPOINT}/token`,
    type: "external_account",
    credential_source: {
      url: `${REPLIT_SIDECAR_ENDPOINT}/credential`,
      format: {
        type: "json",
        subject_token_field_name: "access_token",
      },
    },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

function parseObjectPath(path: string): { bucketName: string; objectName: string } {
  if (!path.startsWith("/")) {
    path = `/${path}`;
  }
  const pathParts = path.split("/");
  if (pathParts.length < 3) {
    throw new Error("Invalid path: must contain at least a bucket name");
  }
  return { bucketName: pathParts[1], objectName: pathParts.slice(2).join("/") };
}

async function signObjectURL({
  bucketName,
  objectName,
  method,
  ttlSec,
}: {
  bucketName: string;
  objectName: string;
  method: "GET" | "PUT" | "DELETE" | "HEAD";
  ttlSec: number;
}): Promise<string> {
  const request = {
    bucket_name: bucketName,
    object_name: objectName,
    method,
    expires_at: new Date(Date.now() + ttlSec * 1000).toISOString(),
  };
  const response = await fetch(`${REPLIT_SIDECAR_ENDPOINT}/object-storage/signed-object-url`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(
      `Failed to sign object URL, errorcode: ${response.status}, make sure you're running on Replit`,
    );
  }
  const data = (await response.json()) as { signed_url: string };
  return data.signed_url;
}

/**
 * Replit Object Storage (GCS) driver, used in the Replit dev environment.
 * Uploads go through a short-lived presigned PUT signed by the Replit sidecar;
 * reads stream directly via the storage client.
 */
export class GcsStorageDriver implements StorageDriver {
  private getPrivateObjectDir(): string {
    const dir = process.env.PRIVATE_OBJECT_DIR || "";
    if (!dir) {
      throw new Error("PRIVATE_OBJECT_DIR not set (required for the replit-gcs storage driver).");
    }
    return dir.endsWith("/") ? dir.slice(0, -1) : dir;
  }

  private getPublicObjectSearchPaths(): Array<string> {
    const pathsStr = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "";
    const paths = Array.from(
      new Set(
        pathsStr
          .split(",")
          .map((p) => p.trim())
          .filter((p) => p.length > 0),
      ),
    );
    if (paths.length === 0) {
      throw new Error("PUBLIC_OBJECT_SEARCH_PATHS not set (required for the replit-gcs storage driver).");
    }
    return paths;
  }

  private async toStoredObject(file: File, visibility: "public" | "private"): Promise<StoredObject> {
    const [metadata] = await file.getMetadata();
    return {
      stream: file.createReadStream(),
      contentType: (metadata.contentType as string) || "application/octet-stream",
      size: metadata.size != null ? Number(metadata.size) : undefined,
      visibility,
    };
  }

  async putPrivateObject(entityId: string, body: Buffer, contentType: string): Promise<void> {
    const fullPath = `${this.getPrivateObjectDir()}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const uploadUrl = await signObjectURL({ bucketName, objectName, method: "PUT", ttlSec: 900 });
    const res = await fetch(uploadUrl, {
      method: "PUT",
      body,
      headers: { "Content-Type": contentType },
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      throw new Error(`GCS upload failed (status ${res.status})`);
    }
  }

  async getPrivateObject(entityId: string): Promise<StoredObject> {
    const fullPath = `${this.getPrivateObjectDir()}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    const [exists] = await file.exists();
    if (!exists) {
      throw new ObjectNotFoundError();
    }
    const aclPolicy = await getObjectAclPolicy(file);
    const visibility = aclPolicy?.visibility === "public" ? "public" : "private";
    return this.toStoredObject(file, visibility);
  }

  async getPublicObject(filePath: string): Promise<StoredObject | null> {
    for (const searchPath of this.getPublicObjectSearchPaths()) {
      const { bucketName, objectName } = parseObjectPath(`${searchPath}/${filePath}`);
      const file = objectStorageClient.bucket(bucketName).file(objectName);
      const [exists] = await file.exists();
      if (exists) {
        return this.toStoredObject(file, "public");
      }
    }
    return null;
  }

  async deletePrivateObject(entityId: string): Promise<void> {
    const fullPath = `${this.getPrivateObjectDir()}/${entityId}`;
    const { bucketName, objectName } = parseObjectPath(fullPath);
    const file = objectStorageClient.bucket(bucketName).file(objectName);
    await file.delete({ ignoreNotFound: true });
  }
}
