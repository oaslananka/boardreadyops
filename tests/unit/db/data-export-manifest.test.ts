import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  ExportInventoryUnavailableError,
  type PendingExportInventory,
} from "../../../packages/db/src/data-export-inventory.js";
import {
  buildPendingExportManifest,
  ExportManifestPreparationError,
  preparePendingExportManifest,
} from "../../../packages/db/src/data-export-manifest.js";

const repo = (id: string, name = id) => ({
  repositoryId: id,
  githubRepositoryId: String(Number.parseInt(createHash("sha256").update(id).digest("hex").slice(0, 12), 16)),
  owner: "ExampleOrg",
  name,
  private: true,
  disabled: false,
});

const inventory = (repositories = [repo("repo-a"), repo("repo-b")]): PendingExportInventory => ({
  formatVersion: 1,
  exportId: "export-123",
  tenantId: "ExampleOrg",
  scope: "organization",
  scopeId: null,
  coverage: "selected-installation-repositories-only",
  repositories,
});

describe("preparation-only export manifest", () => {
  it("emits a deterministic, versioned, bounded JSON manifest with SHA-256", () => {
    const forward = buildPendingExportManifest(inventory());
    const reverse = buildPendingExportManifest(inventory([repo("repo-b"), repo("repo-a")]));
    expect(forward.contentType).toBe("application/json");
    expect(forward.bytes.equals(reverse.bytes)).toBe(true);
    expect(forward.sha256).toBe(createHash("sha256").update(forward.bytes).digest("hex"));
    expect(forward.byteLength).toBe(forward.bytes.byteLength);
    expect(forward.byteLength).toBeLessThan(64 * 1024);
    expect(JSON.parse(forward.bytes.toString("utf8"))).toEqual({
      formatVersion: 1,
      kind: "boardreadyops.repository-metadata-export",
      coverage: "selected-installation-repositories-only",
      exportId: "export-123",
      tenantId: "ExampleOrg",
      scope: "organization",
      scopeId: null,
      exclusions: [
        "source-code",
        "finding-content",
        "artifact-contents",
        "storage-paths",
        "secrets",
        "external-github-data",
        "backups-and-platform-logs",
      ],
      repositories: [repo("repo-a"), repo("repo-b")],
    });
  });

  it("constructs an allowlist without copying unexpected sensitive values", () => {
    const extra = {
      ...repo("repo-a"),
      storage_path: "/private/customer/repo",
      source: "sensitive source",
      token: "secret-token",
      findings: ["private description"],
    };
    const result = buildPendingExportManifest(inventory([extra]));
    const json = result.bytes.toString("utf8");
    expect(json).not.toContain("private/customer");
    expect(json).not.toContain("sensitive source");
    expect(json).not.toContain("secret-token");
    expect(json).not.toContain("findings");
    expect(JSON.parse(json).repositories[0]).toEqual(repo("repo-a"));
  });

  it("denies malformed or ambiguous repository records before emitting bytes", () => {
    const bad = [
      inventory([repo("same"), repo("same")]),
      inventory([repo("repo-a"), { ...repo("repo-b"), githubRepositoryId: "" }]),
      inventory([repo("repo-a"), { ...repo("repo-b"), name: " padded " }]),
      inventory(Array.from({ length: 101 }, (_, i) => repo(`repo-${i}`))),
    ];
    for (const entry of bad) {
      expect(() => buildPendingExportManifest(entry)).toThrow(ExportManifestPreparationError);
    }
  });

  it("denies oversized records rather than silently truncating a deliverable", () => {
    const big = Array.from({ length: 100 }, (_, i) => repo(`repo-${i}`, `part-${i}-${"x".repeat(1000)}`));
    expect(() => buildPendingExportManifest(inventory(big))).toThrow(ExportManifestPreparationError);
  });

  it("checks repository scope ownership and never widens to organization or user", () => {
    const owned = { ...inventory([repo("repo-a")]), scope: "repository" as const, scopeId: "repo-a" };
    expect(JSON.parse(buildPendingExportManifest(owned).bytes.toString("utf8")).scope).toBe("repository");
    expect(() => buildPendingExportManifest({ ...owned, scopeId: "repo-b" })).toThrow(ExportManifestPreparationError);
    expect(() => buildPendingExportManifest({ ...owned, repositories: [] })).toThrow(ExportManifestPreparationError);
    expect(() => buildPendingExportManifest({ ...inventory(), scope: "user" as "organization" })).toThrow(
      ExportManifestPreparationError,
    );
  });

  it("builds only from the pending, installation-scoped store and never changes status", async () => {
    const previewPendingExport = vi.fn().mockResolvedValue(inventory());
    const store = { previewPendingExport };
    const scoped = { exportId: "export-123", tenantId: "ExampleOrg", installationId: "inst-1" };
    const manifest = await preparePendingExportManifest(store, scoped);
    expect(previewPendingExport).toHaveBeenCalledExactlyOnceWith(scoped);
    expect(manifest?.sha256).toMatch(/^[a-f0-9]{64}$/u);
    previewPendingExport.mockResolvedValueOnce(null);
    await expect(preparePendingExportManifest(store, scoped)).resolves.toBeNull();
    previewPendingExport.mockRejectedValueOnce(new ExportInventoryUnavailableError());
    await expect(preparePendingExportManifest(store, scoped)).rejects.toThrow(ExportInventoryUnavailableError);
    expect(Object.keys(store)).toEqual(["previewPendingExport"]);
  });
});
