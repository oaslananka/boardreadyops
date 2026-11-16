import { describe, expect, it, vi } from "vitest";
import {
  createPrivateManufacturingObjectStore,
  parseVerifiedManufacturingStoragePath,
} from "../../../apps/web/lib/private-manufacturing-object-store.js";

const runId = "5dc4193b-5c7e-4df8-b86f-e4d3266fc22d";
const attemptId = "7559e99b-4998-4e02-a94a-7a7a4686ae11";
const uploadId = "9e638297-a3cb-4707-9d44-0f31d60b03ac";
const artifactId = "e2dca950-85e0-4f7e-8d48-e5599d85a3a1";
const sha256 = "a".repeat(64);
const env = {
  NEON_OBJECT_STORAGE_ENDPOINT: "https://br-f1.storage.c-2.eu-central-1.aws.neon.tech",
  NEON_OBJECT_STORAGE_BUCKET: "boardreadyops-manufacturing",
  NEON_OBJECT_STORAGE_ACCESS_KEY_ID: "example-access-id",
  NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY: "example-secret-key",
  NEON_OBJECT_STORAGE_REGION: "eu-central-1",
};

describe("private manufacturing artifact storage", () => {
  it("only allows explicit trusted Neon private-bucket hostnames and credentials", () => {
    expect(() => createPrivateManufacturingObjectStore({ ...env })).not.toThrow();
    for (const endpoint of [
      "http://br-f1.storage.c-2.eu-central-1.aws.neon.tech",
      "https://localhost",
      "https://127.0.0.1",
      "https://br-f1.storage.c-2.eu-central-1.aws.neon.tech.evil.example",
      "https://evil.example",
      "https://user:pass@br-f1.storage.c-2.eu-central-1.aws.neon.tech",
      "https://br-f1.storage.c-2.eu-central-1.aws.neon.tech/data",
      "https://br-f1.storage.c-2.eu-central-1.aws.neon.tech/?redirect=evil",
    ]) {
      expect(() => createPrivateManufacturingObjectStore({ ...env, NEON_OBJECT_STORAGE_ENDPOINT: endpoint })).toThrow();
    }
    expect(() =>
      createPrivateManufacturingObjectStore({ ...env, NEON_OBJECT_STORAGE_BUCKET: "public/../private" }),
    ).toThrow();
    expect(() =>
      createPrivateManufacturingObjectStore({ ...env, NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY: "" }),
    ).toThrow();
  });

  it("issues a short-lived SHA-256 and size-scoped PUT only under the pending run namespace", async () => {
    const store = createPrivateManufacturingObjectStore(env);
    const pending = await store.signPendingUpload({ runId, attemptId, uploadId, sha256, bytes: 2400 });
    const url = new URL(pending.url);
    expect(url.origin).toBe(env.NEON_OBJECT_STORAGE_ENDPOINT);
    expect(url.pathname).toBe(`/boardreadyops-manufacturing/pending/${runId}/${attemptId}/${uploadId}.tar.gz`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("120");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("x-amz-checksum-sha256");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-type");
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toContain("content-length");
    expect(pending.headers).toEqual({
      "content-length": "2400",
      "content-type": "application/gzip",
      "x-amz-checksum-sha256": Buffer.from(sha256, "hex").toString("base64"),
    });
    expect(JSON.stringify(pending)).not.toContain(env.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY);
  });

  it("refuses unbounded, malformed or cross-run direct upload keys", async () => {
    const store = createPrivateManufacturingObjectStore(env);
    const base = { runId, attemptId, uploadId, sha256, bytes: 100 };
    for (const bad of [
      { ...base, runId: "../etc" },
      { ...base, attemptId: "not-a-uuid" },
      { ...base, uploadId: "verified/escape" },
      { ...base, sha256: "nothex" },
      { ...base, bytes: 0 },
      { ...base, bytes: 134217729 },
      { ...base, bytes: 100.25 },
    ]) {
      await expect(store.signPendingUpload(bad)).rejects.toThrow();
    }
  });

  it("only resolves first-party verified key references, not arbitrary S3 paths", () => {
    const valid = `neon-s3/verified/${runId}/${attemptId}/${artifactId}.tar.gz`;
    expect(parseVerifiedManufacturingStoragePath(valid)).toBe(`verified/${runId}/${attemptId}/${artifactId}.tar.gz`);
    expect(parseVerifiedManufacturingStoragePath(valid.replace("verified/", "pending/"))).toBeUndefined();
    expect(parseVerifiedManufacturingStoragePath(`${valid}/../other`)).toBeUndefined();
    expect(parseVerifiedManufacturingStoragePath("neon-s3/verified/unknown")).toBeUndefined();
  });

  it("returns a 60 second private GET signed URL only for server-verified objects", async () => {
    const store = createPrivateManufacturingObjectStore(env);
    const storagePath = `neon-s3/verified/${runId}/${attemptId}/${artifactId}.tar.gz`;
    const signed = await store.signVerifiedDownload(storagePath);
    const url = new URL(signed);
    expect(url.pathname).toContain(`/verified/${runId}/${attemptId}/${artifactId}.tar.gz`);
    expect(url.searchParams.get("X-Amz-Expires")).toBe("60");
    expect(url.searchParams.get("X-Amz-Algorithm")).toBe("AWS4-HMAC-SHA256");
    expect(url.protocol).toBe("https:");
    await expect(store.signVerifiedDownload(storagePath.replace("verified/", "pending/"))).rejects.toThrow();
  });

  it("copies only a pending object to a different verified key in the same run", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 200 }));
    const store = createPrivateManufacturingObjectStore(env, fetcher);
    await store.promotePending({
      runId,
      attemptId,
      uploadId,
      artifactId,
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const request = fetcher.mock.calls[0]?.[0] as unknown as Request;
    expect(request.method).toBe("PUT");
    expect(new URL(request.url).pathname).toContain(`/verified/${runId}/${attemptId}/${artifactId}.tar.gz`);
    expect(request.headers.get("x-amz-copy-source")).toBe(
      `/boardreadyops-manufacturing/pending/${runId}/${attemptId}/${uploadId}.tar.gz`,
    );
    expect(request.headers.get("x-amz-metadata-directive")).toBe("REPLACE");
    expect(request.headers.get("content-type")).toBe("application/gzip");
    expect(request.headers.get("content-disposition")).toBe(
      'attachment; filename="signed-manufacturing-export.tar.gz"',
    );
    expect(request.headers.has("authorization")).toBe(true);
  });

  it("never reports a failed object copy or an unexpected redirect as promoted", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    const store = createPrivateManufacturingObjectStore(env, fetcher);
    await expect(store.promotePending({ runId, attemptId, uploadId, artifactId })).rejects.toThrow(
      "private_object_store_promote_failed",
    );
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
