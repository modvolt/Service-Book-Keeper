import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
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

/**
 * Fully env-driven S3 configuration — NOTHING here is hardcoded.
 *
 * Every value is read from an environment variable, so the whole storage
 * backend can be repointed (e.g. to a different Hetzner bucket/region) purely
 * by changing the environment (Coolify → Environment Variables), with no code
 * change and no redeploy of new code:
 *
 *   Required:
 *     S3_ENDPOINT           — S3-compatible endpoint URL
 *     S3_BUCKET             — bucket name
 *     S3_ACCESS_KEY_ID      — access key
 *     S3_SECRET_ACCESS_KEY  — secret key
 *   Optional (defaults shown):
 *     S3_REGION             — region (default "auto")
 *     S3_FORCE_PATH_STYLE   — "true"/"false" (default "true")
 *     S3_PRIVATE_PREFIX     — key prefix for private objects (default "private")
 *     S3_PUBLIC_PREFIX      — key prefix for public objects (default "public")
 *
 * Missing required values throw a clear error at startup (fail-fast).
 */
export interface S3Config {
  endpoint: string;
  bucket: string;
  region: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
  privatePrefix: string;
  publicPrefix: string;
}

function readS3Config(): S3Config {
  return {
    endpoint: requireEnv("S3_ENDPOINT"),
    bucket: requireEnv("S3_BUCKET"),
    accessKeyId: requireEnv("S3_ACCESS_KEY_ID"),
    secretAccessKey: requireEnv("S3_SECRET_ACCESS_KEY"),
    region: process.env.S3_REGION || "auto",
    forcePathStyle: (process.env.S3_FORCE_PATH_STYLE || "true").toLowerCase() === "true",
    privatePrefix: (process.env.S3_PRIVATE_PREFIX || "private").replace(/^\/+|\/+$/g, ""),
    publicPrefix: (process.env.S3_PUBLIC_PREFIX || "public").replace(/^\/+|\/+$/g, ""),
  };
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
  // S3 ListObjectsV2 supports enumeration, though some providers withhold the
  // s3:ListBucket permission; in that case listPrivateObjects rejects and the
  // caller degrades gracefully (orphan scan reported as unsupported).
  readonly capabilities = { list: true } as const;

  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly privatePrefix: string;
  private readonly publicPrefix: string;

  constructor() {
    const config = readS3Config();
    this.bucket = config.bucket;
    this.privatePrefix = config.privatePrefix;
    this.publicPrefix = config.publicPrefix;
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
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

  async privateObjectExists(entityId: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: `${this.privatePrefix}/${entityId}` }),
      );
      return true;
    } catch (err) {
      if (isNotFound(err)) {
        return false;
      }
      throw err;
    }
  }

  async listPrivateObjects(prefix: string): Promise<string[]> {
    const keyPrefix = `${this.privatePrefix}/${prefix}`;
    const entityIds: string[] = [];
    let continuationToken: string | undefined;
    do {
      const out = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: keyPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of out.Contents ?? []) {
        if (!obj.Key) continue;
        entityIds.push(obj.Key.slice(`${this.privatePrefix}/`.length));
      }
      continuationToken = out.IsTruncated ? out.NextContinuationToken : undefined;
    } while (continuationToken);
    return entityIds;
  }

  async healthCheck(): Promise<void> {
    // Cheap, non-mutating probe: a HEAD on the bucket confirms credentials and
    // endpoint reachability without touching any object.
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
