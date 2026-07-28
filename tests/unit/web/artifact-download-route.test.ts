import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type ArtifactDownloadRecord,
  type ArtifactDownloadRouteDependencies,
  createArtifactDownloadRouteDependencies,
  GET,
  handleArtifactDownloadRequest,
  lookupArtifactDownload,
  recordArtifactDownloadStarted,
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
    installationId: "installation-789",
    repositoryId: "repository-234",
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
  recordDownloadStarted: ArtifactDownloadRouteDependencies["recordDownloadStarted"] = vi.fn(async () => undefined),
): ArtifactDownloadRouteDependencies {
  return {
    environment: {
      ARTIFACT_DOWNLOAD_SIGNING_KEY: signingKey,
      ARTIFACT_STORAGE_DRIVER: "local",
      ARTIFACT_STORAGE_ROOT: storageRoot,
      ...environment,
    },
    lookupArtifact,
    recordDownloadStarted,
    now: () => now,
  };
}

describe("artifact download audit database operations", () => {
  it("looks up tenant dimensions through the release-run repository chain", async () => {
    const query = vi.fn(async () => ({
      rows: [
        {
          id: "artifact-456",
          run_id: "run-123",
          installation_id: "installation-789",
          repository_id: "repository-234",
          kind: "release-archive",
          name: "board.zip",
          storage_path: "run-123/board.zip",
          sha256: "a".repeat(64),
          bytes: 12,
          role: "primary",
        },
      ],
    }));

    await expect(lookupArtifactDownload("run-123", "artifact-456", { query })).resolves.toEqual({
      state: "found",
      artifact: artifact({ name: "board.zip" }),
    });
    const call = (query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>).at(0);
    expect(call).toBeDefined();
    const sql = call?.[0] ?? "";
    const parameters = call?.[1];
    expect(sql).toContain("join release_runs");
    expect(sql).toContain("join repositories");
    expect(sql).toContain("repository.installation_id");
    expect(parameters).toEqual(["artifact-456", "run-123"]);
  });

  it("returns not-found for missing or malformed query results", async () => {
    await expect(
      lookupArtifactDownload("run-123", "artifact-456", { query: vi.fn(async () => ({})) }),
    ).resolves.toEqual({ state: "not-found" });
    await expect(
      lookupArtifactDownload("run-123", "artifact-456", { query: vi.fn(async () => ({ rows: [] })) }),
    ).resolves.toEqual({ state: "not-found" });
  });

  it("shares one configured executor between lookup and audit writes", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "artifact-456",
            run_id: "run-123",
            installation_id: "installation-789",
            repository_id: "repository-234",
            kind: "release-archive",
            name: "board.zip",
            storage_path: "run-123/board.zip",
            sha256: "a".repeat(64),
            bytes: 12,
            role: "primary",
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });
    const executor = { query };
    const createQueryExecutor = vi.fn(() => executor);
    const configured = createArtifactDownloadRouteDependencies(
      { DATABASE_URL: "postgresql://db.example/boardreadyops", DATABASE_POOL_MAX: "7" },
      { createQueryExecutor },
    );

    const lookup = await configured.lookupArtifact("run-123", "artifact-456");
    expect(lookup.state).toBe("found");
    if (lookup.state !== "found") throw new Error("configured artifact was not found");
    await configured.recordDownloadStarted(lookup.artifact);

    expect(createQueryExecutor).toHaveBeenCalledOnce();
    expect(createQueryExecutor).toHaveBeenCalledWith({
      connectionString: "postgresql://db.example/boardreadyops",
      max: 7,
    });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("keeps database operations disabled without a connection string", async () => {
    const createQueryExecutor = vi.fn();
    const disabled = createArtifactDownloadRouteDependencies({}, { createQueryExecutor });

    await expect(disabled.lookupArtifact("run-123", "artifact-456")).resolves.toEqual({
      state: "not-configured",
    });
    await expect(disabled.recordDownloadStarted(artifact())).rejects.toThrow(
      "artifact metadata store is not configured",
    );
    expect(createQueryExecutor).not.toHaveBeenCalled();
  });

  it("writes a fixed tenant-scoped signed-link access event without request secrets", async () => {
    const query = vi.fn(async () => ({ rows: [] }));
    await recordArtifactDownloadStarted(artifact(), { query });

    const call = (query.mock.calls as unknown as Array<[string, readonly unknown[] | undefined]>).at(0);
    expect(call).toBeDefined();
    const sql = call?.[0] ?? "";
    const parameters = call?.[1];
    expect(sql).toContain("insert into audit_events");
    expect(sql).toContain("'artifact.download.started'");
    expect(sql).toContain("'signed_url'");
    expect(sql).toContain("'artifact'");
    expect(parameters).toEqual([
      "installation-789",
      "repository-234",
      "run-123",
      "artifact-456",
      JSON.stringify({
        bytes: 12,
        sha256: "a".repeat(64),
        itemType: "release-archive",
        scope: "primary",
      }),
    ]);
    expect(JSON.stringify(parameters)).not.toContain("sig");
    expect(JSON.stringify(parameters)).not.toContain("authorization");
  });
});

describe("signed artifact download route", () => {
  it("delegates the Next GET wrapper and requires a signed URL", async () => {
    const response = await GET(
      new Request("https://boardreadyops.test/api/v1/runs/run-123/artifacts/artifact-456/download"),
      { params: Promise.resolve({ runId: "run-123", artifactId: "artifact-456" }) },
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "signed artifact URL is required" });
  });

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

  it("hides metadata lookup failures behind a stable unavailable response", async () => {
    const recordDownloadStarted = vi.fn(async () => undefined);
    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(
        "/unused",
        vi.fn(async () => {
          throw new Error("database connection detail must not escape");
        }),
        {},
        recordDownloadStarted,
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "artifact metadata is temporarily unavailable",
    });
    expect(recordDownloadStarted).not.toHaveBeenCalled();
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
    const recordDownloadStarted = vi.fn(async () => undefined);

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(root, lookupArtifact, {}, recordDownloadStarted),
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
    expect(recordDownloadStarted).toHaveBeenCalledOnce();
    expect(recordDownloadStarted).toHaveBeenCalledWith(artifact({ bytes: Buffer.byteLength(payload) }));
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
  it("fails closed without streaming when the download audit cannot be recorded", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "run-123"));
    const payload = "release-data";
    await writeFile(path.join(root, "run-123", "board.zip"), payload);
    const recordDownloadStarted = vi.fn(async () => {
      throw new Error("database detail must not escape");
    });

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(
        root,
        async () => ({ state: "found", artifact: artifact({ bytes: Buffer.byteLength(payload) }) }),
        {},
        recordDownloadStarted,
      ),
    );

    expect(recordDownloadStarted).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "artifact access audit is temporarily unavailable",
    });
  });

  it("does not record access before stored-file validation succeeds", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "run-123"));
    await writeFile(path.join(root, "run-123", "board.zip"), "release-data");
    const recordDownloadStarted = vi.fn(async () => undefined);

    const response = await handleArtifactDownloadRequest(
      signedRequest("run-123", "artifact-456"),
      { runId: "run-123", artifactId: "artifact-456" },
      dependencies(
        root,
        async () => ({ state: "found", artifact: artifact({ bytes: 999 }) }),
        {},
        recordDownloadStarted,
      ),
    );

    expect(response.status).toBe(409);
    expect(recordDownloadStarted).not.toHaveBeenCalled();
  });
});
