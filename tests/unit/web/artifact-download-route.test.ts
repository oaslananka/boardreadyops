import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ArtifactDownloadRecord,
  type ArtifactDownloadRouteDependencies,
  handleArtifactDownloadRequest,
} from "../../../apps/web/app/api/v1/runs/[runId]/artifacts/[artifactId]/download/route.js";
import { artifactDownloadExpiry, signArtifactDownload } from "../../../apps/web/lib/artifact-downloads.js";

const signingKey = "k".repeat(32);
const now = Date.UTC(2026, 6, 10, 18, 0, 0);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "boardreadyops-route-artifacts-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function signedRequest(
  runId: string,
  artifactId: string,
  overrides: { expiresAt?: number; signature?: string } = {},
): Request {
  const expiresAt = overrides.expiresAt ?? artifactDownloadExpiry(now, 300);
  const signature =
    overrides.signature ?? signArtifactDownload({ runId, artifactId, expiresAt }, signingKey) ?? "missing";
  const url = new URL(
    `https://boardreadyops.test/api/v1/runs/${encodeURIComponent(runId)}/artifacts/${encodeURIComponent(artifactId)}/download`,
  );
  url.searchParams.set("exp", String(expiresAt));
  url.searchParams.set("sig", signature);
  return new Request(url);
}

function artifact(overrides: Partial<ArtifactDownloadRecord> = {}): ArtifactDownloadRecord {
  return {
    id: "artifact-456",
    runId: "run-123",
    kind: "release-archive",
    name: "board résumé.zip",
    storagePath: "run-123/board.zip",
    sha256: "a".repeat(64),
    bytes: 12,
    role: "primary",
    ...overrides,
  };
}

function dependencies(
  storageRoot: string,
  lookupArtifact: ArtifactDownloadRouteDependencies["lookupArtifact"],
  environment: Readonly<Record<string, string | undefined>> = {},
): ArtifactDownloadRouteDependencies {
  return {
    environment: {
      ARTIFACT_DOWNLOAD_SIGNING_KEY: signingKey,
      ARTIFACT_STORAGE_DRIVER: "local",
      ARTIFACT_STORAGE_ROOT: storageRoot,
      ...environment,
    },
    lookupArtifact,
    now: () => now,
  };
}

describe("signed artifact download route", () => {
  it("rejects invalid signatures before querying artifact metadata", async () => {
    const lookupArtifact = vi.fn();
    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456", { signature: "invalid" }),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies("/unused", lookupArtifact),
    );

    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(lookupArtifact).not.toHaveBeenCalled();
  });

  it("streams an authorized local artifact with defensive response headers", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "run-123"));
    const payload = "release-data";
    await writeFile(path.join(root, "run-123", "board.zip"), payload);
    const lookupArtifact = vi.fn(async () => ({
      state: "found" as const,
      artifact: artifact({ bytes: Buffer.byteLength(payload) }),
    }));

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(root, lookupArtifact),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(payload);
    expect(response.headers.get("content-length")).toBe(String(Buffer.byteLength(payload)));
    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("x-boardreadyops-artifact-id")).toBe("artifact-456");
    expect(response.headers.get("x-boardreadyops-artifact-sha256")).toBe("a".repeat(64));
    expect(response.headers.get("content-disposition")).toContain("filename*=UTF-8''board%20r%C3%A9sum%C3%A9.zip");
  });

  it("rejects metadata size mismatches without serving the file", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "run-123"));
    await writeFile(path.join(root, "run-123", "board.zip"), "release-data");

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(root, async () => ({ state: "found", artifact: artifact({ bytes: 999 }) })),
    );

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: "artifact metadata does not match the stored file",
    });
  });

  it("rejects paths outside the configured storage root", async () => {
    const root = await temporaryDirectory();

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(root, async () => ({
        state: "found",
        artifact: artifact({ storagePath: "../private.zip" }),
      })),
    );

    expect(response.status).toBe(403);
  });

  it("distinguishes missing metadata, unconfigured metadata, and unsupported storage", async () => {
    const root = await temporaryDirectory();
    const request = signedRequest("run-123", "artifact-456");
    const params = { runId: "run-123", artifactId: "artifact-456" };

    const missing = await handleArtifactDownloadRequest(
      request,
      params,
      dependencies(root, async () => ({ state: "not-found" })),
    );
    expect(missing.status).toBe(404);

    const unconfigured = await handleArtifactDownloadRequest(
      request,
      params,
      dependencies(root, async () => ({ state: "not-configured" })),
    );
    expect(unconfigured.status).toBe(503);

    const unsupported = await handleArtifactDownloadRequest(
      request,
      params,
      dependencies(root, async () => ({ state: "found", artifact: artifact() }), { ARTIFACT_STORAGE_DRIVER: "s3" }),
    );
    expect(unsupported.status).toBe(501);
  });
});
