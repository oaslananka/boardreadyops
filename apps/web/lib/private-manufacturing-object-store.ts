import { AwsClient } from "aws4fetch";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const sha256Pattern = /^[0-9a-f]{64}$/u;
const pendingPrefix = "pending";
const verifiedPrefix = "verified";
const storagePrefix = "neon-s3/";
const maximumArchiveBytes = 128 * 1024 * 1024;
const storageEndpointPattern = /^[a-z0-9-]+\.storage\.c-[0-9]+\.[a-z0-9-]+\.aws\.neon\.tech$/u;
const bucketPattern = /^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/u;

type ManufacturingObjectScope = {
  runId: string;
  attemptId: string;
};

export type ManufacturingObjectUploadInput = ManufacturingObjectScope & {
  uploadId: string;
  sha256: string;
  bytes: number;
};

type ManufacturingObjectPromotion = ManufacturingObjectScope & {
  uploadId: string;
  artifactId: string;
};

type ManufacturingObjectStorageConfig = {
  NEON_OBJECT_STORAGE_ENDPOINT?: string;
  NEON_OBJECT_STORAGE_BUCKET?: string;
  NEON_OBJECT_STORAGE_ACCESS_KEY_ID?: string;
  NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY?: string;
  NEON_OBJECT_STORAGE_REGION?: string;
};

function requiredString(value: string | undefined): string {
  if (!value?.trim()) throw new Error("Private manufacturing object storage is not configured");
  return value.trim();
}

function checkedUuid(value: string): string {
  if (!uuidPattern.test(value)) throw new Error("Invalid manufacturing object identity");
  return value;
}

function pendingKey(input: ManufacturingObjectScope & { uploadId: string }): string {
  return (
    [pendingPrefix, checkedUuid(input.runId), checkedUuid(input.attemptId), checkedUuid(input.uploadId)].join("/") +
    ".tar.gz"
  );
}

function verifiedKey(input: ManufacturingObjectScope & { artifactId: string }): string {
  return (
    [verifiedPrefix, checkedUuid(input.runId), checkedUuid(input.attemptId), checkedUuid(input.artifactId)].join("/") +
    ".tar.gz"
  );
}

/** Only server-promoted objects can be exposed as first-party downloads. */
export function parseVerifiedManufacturingStoragePath(storagePath: string): string | undefined {
  if (!storagePath.startsWith(storagePrefix)) return undefined;
  const key = storagePath.slice(storagePrefix.length);
  const parts = key.split("/");
  if (parts.length !== 4 || parts[0] !== verifiedPrefix || !parts[3]?.endsWith(".tar.gz")) return undefined;
  const id = parts[3].slice(0, -".tar.gz".length);
  if (!parts[1] || !parts[2] || !uuidPattern.test(parts[1]) || !uuidPattern.test(parts[2]) || !uuidPattern.test(id))
    return undefined;
  return key;
}

export function verifiedManufacturingStoragePath(input: ManufacturingObjectPromotion): string {
  return storagePrefix + verifiedKey(input);
}

/**
 * A private, branch-scoped Neon S3 transport. No public-read buckets, caller
 * URLs or arbitrary object keys. Caller must independently authorize the run
 * and verify the final stored archive before publishing its database record.
 */
export function createPrivateManufacturingObjectStore(
  environment: ManufacturingObjectStorageConfig,
  fetcher: typeof fetch = fetch,
) {
  const rawEndpoint = requiredString(environment.NEON_OBJECT_STORAGE_ENDPOINT);
  let endpoint: URL;
  try {
    endpoint = new URL(rawEndpoint);
  } catch {
    throw new Error("Invalid private object storage endpoint");
  }
  if (
    endpoint.protocol !== "https:" ||
    !storageEndpointPattern.test(endpoint.hostname) ||
    endpoint.username ||
    endpoint.password ||
    endpoint.port ||
    endpoint.pathname !== "/" ||
    endpoint.search ||
    endpoint.hash
  ) {
    throw new Error("Private object storage requires a canonical Neon branch endpoint");
  }
  const bucket = requiredString(environment.NEON_OBJECT_STORAGE_BUCKET);
  if (!bucketPattern.test(bucket)) throw new Error("Invalid private object storage bucket");
  const region = requiredString(environment.NEON_OBJECT_STORAGE_REGION);
  if (!/^[a-z]{2}-[a-z]+-\d$/u.test(region)) throw new Error("Invalid private object storage region");
  const client = new AwsClient({
    accessKeyId: requiredString(environment.NEON_OBJECT_STORAGE_ACCESS_KEY_ID),
    secretAccessKey: requiredString(environment.NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY),
    service: "s3",
    region,
    retries: 0,
  });
  const objectUrl = (key: string): string => new URL(`/${bucket}/${key}`, endpoint).toString();
  const signedResponse = async (key: string, method: string, headers?: Record<string, string>): Promise<Response> => {
    const signed = await client.sign(objectUrl(key), headers ? { method, headers } : { method });
    return await fetcher(signed, {
      redirect: "error",
      signal: AbortSignal.timeout(method === "GET" ? 120_000 : 20_000),
    });
  };

  return {
    async signPendingUpload(input: ManufacturingObjectUploadInput) {
      const key = pendingKey(input);
      if (!sha256Pattern.test(input.sha256)) throw new Error("Invalid manufacturing archive digest");
      if (!Number.isSafeInteger(input.bytes) || input.bytes < 1 || input.bytes > maximumArchiveBytes) {
        throw new Error("Manufacturing archive exceeds the bounded storage contract");
      }
      const headers = {
        "content-length": String(input.bytes),
        "content-type": "application/gzip",
        "x-amz-checksum-sha256": Buffer.from(input.sha256, "hex").toString("base64"),
      };
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", "120");
      const signed = await client.sign(url.toString(), {
        method: "PUT",
        headers,
        aws: { signQuery: true, allHeaders: true },
      });
      return { url: signed.url, headers, key };
    },

    async signVerifiedDownload(storagePath: string): Promise<string> {
      const key = parseVerifiedManufacturingStoragePath(storagePath);
      if (!key) throw new Error("Only verified manufacturing objects may be downloaded");
      const url = new URL(objectUrl(key));
      url.searchParams.set("X-Amz-Expires", "60");
      return (await client.sign(url.toString(), { method: "GET", aws: { signQuery: true } })).url;
    },

    async promotePending(input: ManufacturingObjectPromotion): Promise<void> {
      const source = pendingKey(input);
      const destination = verifiedKey(input);
      const response = await signedResponse(destination, "PUT", {
        "x-amz-copy-source": `/${bucket}/${source}`,
      }).catch(() => undefined);
      if (!response?.ok) throw new Error("private_object_store_promote_failed");
      await response.arrayBuffer().catch(() => undefined);
    },

    async getVerified(storagePath: string): Promise<Response> {
      const key = parseVerifiedManufacturingStoragePath(storagePath);
      if (!key) throw new Error("Only verified manufacturing objects may be read");
      const response = await signedResponse(key, "GET").catch(() => undefined);
      if (!response?.ok || !response.body) throw new Error("private_object_store_read_failed");
      return response;
    },

    async deletePending(input: ManufacturingObjectScope & { uploadId: string }): Promise<void> {
      const response = await signedResponse(pendingKey(input), "DELETE").catch(() => undefined);
      if (!response?.ok && response?.status !== 404) throw new Error("private_object_store_cleanup_failed");
    },

    async deleteVerified(storagePath: string): Promise<void> {
      const key = parseVerifiedManufacturingStoragePath(storagePath);
      if (!key) throw new Error("Only verified manufacturing objects may be removed");
      const response = await signedResponse(key, "DELETE").catch(() => undefined);
      if (!response?.ok && response?.status !== 404) throw new Error("private_object_store_cleanup_failed");
    },
  };
}
