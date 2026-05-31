import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  type GetObjectCommandOutput,
} from "@aws-sdk/client-s3";
import type { Readable } from "stream";
import { ObjectNotFoundError, type StorageDriver, type StoredObject } from "./types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} not set (required for the s3 storage driver).`);
  }
  return value;
}

function isNotFound(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: string }).name;
  const status = (err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
  return name === "NoSuchKey" || name === "NotFound" || status === 404;
}

/**
 * S3-compatible driver (e.g. Hetzner Object Storage) for production.
 *
 * A single private bucket holds everything; objects are partitioned by prefix
 * (`S3_PRIVATE_PREFIX` / `S3_PUBLIC_PREFIX`). Uploads and downloads are always
 * proxied through the server, so the bucket needs no CORS configuration.
 */
export class S3StorageDriver implements StorageDriver {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly privatePrefix: string;
  private readonly publicPrefix: string;

  constructor() {
    this.bucket = requireEnv("S3_BUCKET");
    this.privatePrefix = (process.env.S3_PRIVATE_PREFIX || "private").replace(/^\/+|\/+$/g, "");
    this.publicPrefix = (process.env.S3_PUBLIC_PREFIX || "public").replace(/^\/+|\/+$/g, "");
    this.client = new S3Client({
      endpoint: requireEnv("S3_ENDPOINT"),
      region: process.env.S3_REGION || "auto",
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
      credentials: {
        accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
        secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
      },
    });
  }

  private toStoredObject(out: GetObjectCommandOutput, visibility: "public" | "private"): StoredObject {
    return {
      stream: out.Body as Readable,
      contentType: out.ContentType || "application/octet-stream",
      size: out.ContentLength != null ? Number(out.ContentLength) : undefined,
      visibility,
    };
  }

  async putPrivateObject(entityId: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: `${this.privatePrefix}/${entityId}`,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async getPrivateObject(entityId: string): Promise<StoredObject> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: `${this.privatePrefix}/${entityId}` }),
      );
      return this.toStoredObject(out, "private");
    } catch (err) {
      if (isNotFound(err)) {
        throw new ObjectNotFoundError();
      }
      throw err;
    }
  }

  async getPublicObject(filePath: string): Promise<StoredObject | null> {
    try {
      const out = await this.client.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: `${this.publicPrefix}/${filePath}` }),
      );
      return this.toStoredObject(out, "public");
    } catch (err) {
      if (isNotFound(err)) {
        return null;
      }
      throw err;
    }
  }

  async deletePrivateObject(entityId: string): Promise<void> {
    try {
      await this.client.send(
        new DeleteObjectCommand({ Bucket: this.bucket, Key: `${this.privatePrefix}/${entityId}` }),
      );
    } catch (err) {
      if (isNotFound(err)) {
        return;
      }
      throw err;
    }
  }
}
