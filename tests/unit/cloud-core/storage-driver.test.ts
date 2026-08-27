import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import {
  createArtifactStorage,
  LocalArtifactStorage,
  S3ArtifactStorage,
} from "../../../packages/cloud-core/src/storage.js";

const sha256Of = (content: string) => createHash("sha256").update(content).digest("hex");

describe("LocalArtifactStorage", () => {
  const bytes = Buffer.byteLength("artifact-bytes");
  const sha256 = sha256Of("artifact-bytes");

  it("completes an upload after beginUpload and can then download and delete it", async () => {
    const storage = new LocalArtifactStorage();
    const cap = await storage.beginUpload({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      key: "reports/report.html",
      contentType: "text/html",
      bytes,
      sha256,
    });
    expect(cap.uploadId).toBeTruthy();

    const stored = await storage.completeUpload({
      tenantId: "tenant-a",
      key: "reports/report.html",
      uploadId: cap.uploadId,
      sha256,
      bytes,
    });
    expect(stored.sha256).toBe(sha256);

    const download = await storage.openDownload({ tenantId: "tenant-a", key: "reports/report.html" });
    expect(download.url).toContain("tenant-a");
    expect(download.contentDisposition).toContain("report.html");

    await expect(storage.deleteObject({ tenantId: "tenant-a", key: "reports/report.html" })).resolves.toBe("deleted");
    await expect(storage.deleteObject({ tenantId: "tenant-a", key: "reports/report.html" })).resolves.toBe("missing");
  });

  it("rejects an invalid sha256 and an oversized object at beginUpload", async () => {
    const storage = new LocalArtifactStorage();
    await expect(
      storage.beginUpload({
        tenantId: "tenant-a",
        repositoryId: "repo-1",
        key: "x",
        contentType: "text/plain",
        bytes: 10,
        sha256: "not-a-hash",
      }),
    ).rejects.toThrow("Invalid sha256");

    await expect(
      storage.beginUpload({
        tenantId: "tenant-a",
        repositoryId: "repo-1",
        key: "x",
        contentType: "text/plain",
        bytes: 2 * 1_073_741_824,
        sha256,
      }),
    ).rejects.toThrow("Object too large");
  });

  it("rejects a content type that is not allowlisted and is not an image/* type", async () => {
    const storage = new LocalArtifactStorage();
    await expect(
      storage.beginUpload({
        tenantId: "tenant-a",
        repositoryId: "repo-1",
        key: "x",
        contentType: "application/x-executable",
        bytes: 10,
        sha256,
      }),
    ).rejects.toThrow("Content type not allowlisted");
  });

  it("rejects completeUpload for an unknown or mismatched upload capability", async () => {
    const storage = new LocalArtifactStorage();
    await expect(
      storage.completeUpload({ tenantId: "tenant-a", key: "x", uploadId: "missing", sha256, bytes }),
    ).rejects.toThrow("Upload capability expired or not found");

    const cap = await storage.beginUpload({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      key: "reports/other.html",
      contentType: "text/html",
      bytes,
      sha256,
    });

    await expect(
      storage.completeUpload({
        tenantId: "tenant-b",
        key: "reports/other.html",
        uploadId: cap.uploadId,
        sha256,
        bytes,
      }),
    ).rejects.toThrow("Key/tenant mismatch");

    await expect(
      storage.completeUpload({
        tenantId: "tenant-a",
        key: "reports/other.html",
        uploadId: cap.uploadId,
        sha256: sha256Of("different-content"),
        bytes,
      }),
    ).rejects.toThrow("SHA mismatch");

    await expect(
      storage.completeUpload({
        tenantId: "tenant-a",
        key: "reports/other.html",
        uploadId: cap.uploadId,
        sha256,
        bytes: bytes + 1,
      }),
    ).rejects.toThrow("Byte length mismatch");
  });

  it("rejects opening a download for an object that was never completed", async () => {
    const storage = new LocalArtifactStorage();
    await expect(storage.openDownload({ tenantId: "tenant-a", key: "never-uploaded" })).rejects.toThrow(
      "Object not found",
    );
  });
});

describe("S3ArtifactStorage", () => {
  const originalBucket = process.env.AWS_S3_BUCKET;
  const originalRegion = process.env.AWS_REGION;

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.AWS_S3_BUCKET;
    else process.env.AWS_S3_BUCKET = originalBucket;
    if (originalRegion === undefined) delete process.env.AWS_REGION;
    else process.env.AWS_REGION = originalRegion;
  });

  it("delegates to the local driver when AWS credentials are not configured", async () => {
    delete process.env.AWS_S3_BUCKET;
    delete process.env.AWS_REGION;
    const storage = new S3ArtifactStorage();
    const bytes = Buffer.byteLength("x");
    const sha256 = sha256Of("x");
    const cap = await storage.beginUpload({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      key: "a",
      contentType: "text/plain",
      bytes,
      sha256,
    });
    await storage.completeUpload({ tenantId: "tenant-a", key: "a", uploadId: cap.uploadId, sha256, bytes });
    await expect(storage.openDownload({ tenantId: "tenant-a", key: "a" })).resolves.toMatchObject({
      contentType: "text/plain",
    });
    await expect(storage.deleteObject({ tenantId: "tenant-a", key: "a" })).resolves.toBe("deleted");
  });

  it("also delegates to the local driver when AWS_S3_BUCKET/AWS_REGION are set (no live AWS call)", async () => {
    process.env.AWS_S3_BUCKET = "boardreadyops-artifacts";
    process.env.AWS_REGION = "us-east-1";
    const storage = new S3ArtifactStorage();
    const bytes = Buffer.byteLength("y");
    const sha256 = sha256Of("y");
    const cap = await storage.beginUpload({
      tenantId: "tenant-a",
      repositoryId: "repo-1",
      key: "b",
      contentType: "text/plain",
      bytes,
      sha256,
    });
    await expect(
      storage.completeUpload({ tenantId: "tenant-a", key: "b", uploadId: cap.uploadId, sha256, bytes }),
    ).resolves.toMatchObject({ sha256 });
  });
});

describe("createArtifactStorage", () => {
  const originalBucket = process.env.AWS_S3_BUCKET;

  afterEach(() => {
    if (originalBucket === undefined) delete process.env.AWS_S3_BUCKET;
    else process.env.AWS_S3_BUCKET = originalBucket;
  });

  it("returns a LocalArtifactStorage when AWS_S3_BUCKET is not set", () => {
    delete process.env.AWS_S3_BUCKET;
    expect(createArtifactStorage()).toBeInstanceOf(LocalArtifactStorage);
  });

  it("returns an S3ArtifactStorage when AWS_S3_BUCKET is set", () => {
    process.env.AWS_S3_BUCKET = "boardreadyops-artifacts";
    expect(createArtifactStorage()).toBeInstanceOf(S3ArtifactStorage);
  });
});
