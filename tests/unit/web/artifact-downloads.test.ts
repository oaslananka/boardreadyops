import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  artifactAttachmentHeader,
  artifactDownloadExpiry,
  artifactDownloadMaxTtlSeconds,
  artifactDownloadUrl,
  resolveLocalArtifactFile,
  safeLocalArtifactPath,
  signArtifactDownload,
  verifyArtifactDownloadSignature,
} from "../../../apps/web/lib/artifact-downloads.js";

const signingKey = "a".repeat(32);
const now = Date.UTC(2026, 6, 10, 18, 0, 0);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("artifact download signatures", () => {
  it("binds the signature to run, artifact, and bounded expiry", () => {
    const expiresAt = artifactDownloadExpiry(now, 300);
    const signature = signArtifactDownload({ runId: "run-123", artifactId: "artifact-456", expiresAt }, signingKey);

    expect(signature).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      verifyArtifactDownloadSignature(
        { runId: "run-123", artifactId: "artifact-456", expiresAt, signature: signature ?? "" },
        signingKey,
        now,
      ),
    ).toBe(true);
    expect(
      verifyArtifactDownloadSignature(
        { runId: "run-999", artifactId: "artifact-456", expiresAt, signature: signature ?? "" },
        signingKey,
        now,
      ),
    ).toBe(false);
    expect(
      verifyArtifactDownloadSignature(
        { runId: "run-123", artifactId: "artifact-999", expiresAt, signature: signature ?? "" },
        signingKey,
        now,
      ),
    ).toBe(false);
  });

  it("rejects expired, excessively long, malformed, and weakly keyed signatures", () => {
    const expiredAt = Math.floor(now / 1000) - 1;
    const futureAt = Math.floor(now / 1000) + artifactDownloadMaxTtlSeconds + 1;
    const expiredSignature = signArtifactDownload(
      { runId: "run-123", artifactId: "artifact-456", expiresAt: expiredAt },
      signingKey,
    );
    const futureSignature = signArtifactDownload(
      { runId: "run-123", artifactId: "artifact-456", expiresAt: futureAt },
      signingKey,
    );

    expect(
      verifyArtifactDownloadSignature(
        { runId: "run-123", artifactId: "artifact-456", expiresAt: expiredAt, signature: expiredSignature ?? "" },
        signingKey,
        now,
      ),
    ).toBe(false);
    expect(
      verifyArtifactDownloadSignature(
        { runId: "run-123", artifactId: "artifact-456", expiresAt: futureAt, signature: futureSignature ?? "" },
        signingKey,
        now,
      ),
    ).toBe(false);
    expect(
      verifyArtifactDownloadSignature(
        {
          runId: "run-123",
          artifactId: "artifact-456",
          expiresAt: artifactDownloadExpiry(now),
          signature: "not-valid",
        },
        signingKey,
        now,
      ),
    ).toBe(false);
    expect(
      signArtifactDownload(
        { runId: "run-123", artifactId: "artifact-456", expiresAt: artifactDownloadExpiry(now) },
        "short-key",
      ),
    ).toBeUndefined();
  });

  it("enforces the configured TTL ceiling", () => {
    expect(() => artifactDownloadExpiry(now, 0)).toThrow(RangeError);
    expect(() => artifactDownloadExpiry(now, artifactDownloadMaxTtlSeconds + 1)).toThrow(RangeError);
    expect(artifactDownloadExpiry(now, artifactDownloadMaxTtlSeconds)).toBe(
      Math.floor(now / 1000) + artifactDownloadMaxTtlSeconds,
    );
  });

  it("produces encoded signed URLs only with a valid base URL and dedicated key", () => {
    const expiresAt = artifactDownloadExpiry(now, 120);
    const url = artifactDownloadUrl({
      runId: "run/with spaces",
      artifactId: "artifact?#1",
      expiresAt,
      baseUrl: "https://boardreadyops.test/base/path",
      key: signingKey,
    });

    expect(url).toBeDefined();
    const parsed = new URL(url ?? "https://invalid.test");
    expect(parsed.pathname).toBe("/api/v1/runs/run%2Fwith%20spaces/artifacts/artifact%3F%231/download");
    expect(parsed.searchParams.get("exp")).toBe(String(expiresAt));
    expect(parsed.searchParams.get("sig")).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(artifactDownloadUrl({ runId: "run", artifactId: "artifact", expiresAt, key: signingKey })).toBeUndefined();
    expect(
      artifactDownloadUrl({
        runId: "run",
        artifactId: "artifact",
        expiresAt,
        baseUrl: "not a URL",
        key: signingKey,
      }),
    ).toBeUndefined();
  });
});

describe("local artifact containment", () => {
  it("rejects lexical traversal and resolves regular files inside the root", async () => {
    const root = await temporaryDirectory("boardreadyops-artifacts-");
    await mkdir(path.join(root, "run-123"));
    await writeFile(path.join(root, "run-123", "artifact.zip"), "release-data");

    expect(safeLocalArtifactPath(root, "../outside.zip")).toBeUndefined();
    expect(safeLocalArtifactPath(root, path.resolve(root, "../outside.zip"))).toBeUndefined();
    await expect(resolveLocalArtifactFile(root, "run-123/artifact.zip")).resolves.toEqual({
      state: "resolved",
      path: await pathToRealPath(path.join(root, "run-123", "artifact.zip")),
    });
    await expect(resolveLocalArtifactFile(root, "run-123/missing.zip")).resolves.toEqual({
      state: "file-unavailable",
    });
  });

  it.skipIf(process.platform === "win32")("rejects a symlink that escapes the storage root", async () => {
    const parent = await temporaryDirectory("boardreadyops-artifact-links-");
    const root = path.join(parent, "root");
    const outside = path.join(parent, "outside");
    await mkdir(root);
    await mkdir(outside);
    await writeFile(path.join(outside, "secret.zip"), "secret");
    await symlink(outside, path.join(root, "escaped"), "dir");

    await expect(resolveLocalArtifactFile(root, "escaped/secret.zip")).resolves.toEqual({
      state: "outside-root",
    });
  });
});

describe("artifact attachment headers", () => {
  it("provides an ASCII fallback and RFC 5987 UTF-8 filename", () => {
    const header = artifactAttachmentHeader('../résumé "final";\r\n.zip');

    expect(header).toContain('attachment; filename="resume _final____.zip"');
    expect(header).toContain("filename*=UTF-8''r%C3%A9sum%C3%A9%20%22final%22%3B__.zip");
    expect(header).not.toContain("\r");
    expect(header).not.toContain("\n");
  });
});

async function pathToRealPath(input: string): Promise<string> {
  const { realpath } = await import("node:fs/promises");
  return await realpath(input);
}
