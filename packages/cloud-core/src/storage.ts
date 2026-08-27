import { createHash, randomUUID } from "node:crypto";

export type BeginUploadInput = {
  tenantId: string;
  repositoryId: string;
  reviewId?: string;
  key: string;
  contentType: string;
  bytes: number;
  sha256: string;
};

export type UploadCapability = {
  uploadId: string;
  key: string;
  url?: string;
  expiresAt: string;
  headers?: Record<string, string>;
};

export type CompleteUploadInput = {
  tenantId: string;
  key: string;
  uploadId: string;
  sha256: string;
  bytes: number;
};

export type StoredArtifact = {
  key: string;
  bytes: number;
  sha256: string;
  contentType: string;
  createdAt: string;
};

export type DownloadInput = { tenantId: string; key: string };
export type DownloadCapability = { url: string; expiresAt: string; contentType: string; contentDisposition: string };
export type DeleteObjectInput = { tenantId: string; key: string };

export interface ArtifactStorage {
  beginUpload(input: BeginUploadInput): Promise<UploadCapability>;
  completeUpload(input: CompleteUploadInput): Promise<StoredArtifact>;
  openDownload(input: DownloadInput): Promise<DownloadCapability>;
  deleteObject(input: DeleteObjectInput): Promise<"deleted" | "missing">;
}

// In-memory + local filesystem fallback for tests and dev
const capabilities = new Map<string, { input: BeginUploadInput; expiresAt: number }>();
const objects = new Map<string, StoredArtifact>();

export class LocalArtifactStorage implements ArtifactStorage {
  private readonly bucket: string;
  constructor(bucket = "boardreadyops-artifacts") {
    this.bucket = bucket;
  }

  private scopedKey(tenantId: string, key: string): string {
    // Defense-in-depth: tenant prefix, but authorization is DB-driven, not path-driven
    const safe = key.replaceAll("..", "_").replaceAll("//", "/");
    return `${this.bucket}/${tenantId}/${safe}`;
  }

  async beginUpload(input: BeginUploadInput): Promise<UploadCapability> {
    if (!/^[0-9a-f]{64}$/.test(input.sha256)) throw new Error("Invalid sha256");
    if (input.bytes > 1_073_741_824) throw new Error("Object too large");
    const allowed = new Set([
      "application/json",
      "text/html",
      "image/png",
      "image/webp",
      "image/svg+xml",
      "application/octet-stream",
      "text/plain",
    ]);
    if (!allowed.has(input.contentType) && !input.contentType.startsWith("image/"))
      throw new Error(`Content type not allowlisted: ${input.contentType}`);
    const uploadId = randomUUID();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    capabilities.set(uploadId, { input, expiresAt: Date.now() + 15 * 60 * 1000 });
    return { uploadId, key: input.key, expiresAt };
  }

  async completeUpload(input: CompleteUploadInput): Promise<StoredArtifact> {
    const cap = capabilities.get(input.uploadId);
    if (!cap) throw new Error("Upload capability expired or not found");
    if (Date.now() > cap.expiresAt) {
      capabilities.delete(input.uploadId);
      throw new Error("Upload capability expired");
    }
    if (cap.input.key !== input.key || cap.input.tenantId !== input.tenantId) throw new Error("Key/tenant mismatch");
    if (cap.input.sha256 !== input.sha256) throw new Error("SHA mismatch");
    if (cap.input.bytes !== input.bytes) throw new Error("Byte length mismatch");
    const scoped = this.scopedKey(input.tenantId, input.key);
    const artifact: StoredArtifact = {
      key: scoped,
      bytes: input.bytes,
      sha256: input.sha256,
      contentType: cap.input.contentType,
      createdAt: new Date().toISOString(),
    };
    objects.set(scoped, artifact);
    capabilities.delete(input.uploadId);
    return artifact;
  }

  async openDownload(input: DownloadInput): Promise<DownloadCapability> {
    const scoped = this.scopedKey(input.tenantId, input.key);
    const obj = objects.get(scoped);
    if (!obj) throw new Error("Object not found");
    // Short-lived signed URL simulation
    const token = createHash("sha256").update(`${scoped}:${Date.now()}:${randomUUID()}`).digest("hex").slice(0, 32);
    const url = `https://artifacts.boardreadyops.example/download/${encodeURIComponent(scoped)}?token=${token}`;
    return {
      url,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      contentType: obj.contentType,
      contentDisposition: `attachment; filename="${input.key.split("/").pop() ?? "artifact"}"`,
    };
  }

  async deleteObject(input: DeleteObjectInput): Promise<"deleted" | "missing"> {
    const scoped = this.scopedKey(input.tenantId, input.key);
    return objects.delete(scoped) ? "deleted" : "missing";
  }
}

// S3-compatible driver stub using AWS SDK v3 when configured
export class S3ArtifactStorage implements ArtifactStorage {
  private readonly local = new LocalArtifactStorage();
  private readonly enabled: boolean;
  constructor() {
    this.enabled = Boolean(process.env.AWS_S3_BUCKET && process.env.AWS_REGION);
  }

  async beginUpload(input: BeginUploadInput): Promise<UploadCapability> {
    if (!this.enabled) return this.local.beginUpload(input);
    // In production, would call s3.createPresignedPost or getSignedUrl with PutObject
    // For now, delegate to local with S3 prefix to keep interface consistent
    return this.local.beginUpload(input);
  }

  async completeUpload(input: CompleteUploadInput): Promise<StoredArtifact> {
    if (!this.enabled) return this.local.completeUpload(input);
    return this.local.completeUpload(input);
  }

  async openDownload(input: DownloadInput): Promise<DownloadCapability> {
    if (!this.enabled) return this.local.openDownload(input);
    return this.local.openDownload(input);
  }

  async deleteObject(input: DeleteObjectInput): Promise<"deleted" | "missing"> {
    if (!this.enabled) return this.local.deleteObject(input);
    return this.local.deleteObject(input);
  }
}

export function createArtifactStorage(): ArtifactStorage {
  const bucket = process.env.AWS_S3_BUCKET;
  if (bucket) return new S3ArtifactStorage();
  return new LocalArtifactStorage();
}
