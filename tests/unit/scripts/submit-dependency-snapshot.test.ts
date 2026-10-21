import { describe, expect, it } from "vitest";
import { buildSnapshot, snapshotFromResolvedBom } from "../../../scripts/submit-dependency-snapshot.mjs";

const options = {
  sha: "a".repeat(40),
  ref: "refs/heads/main",
  scanned: "2026-10-21T00:00:00.000Z",
  runId: 123,
};

describe("complete dependency graph submission", () => {
  it("reflects every real resolved pnpm package and patched markdown-it, without hiding vulnerabilities", async () => {
    const snapshot = await buildSnapshot(options);
    const resolved = snapshot.manifests["pnpm-lock.yaml"].resolved;
    expect(Object.keys(resolved).length).toBeGreaterThan(1000);
    expect(resolved["pkg:npm/markdown-it@14.3.3"]).toMatchObject({
      relationship: "indirect",
      scope: "development",
    });
    expect(Object.keys(resolved).some((purl) => purl.includes("markdown-it@14.3.2"))).toBe(false);
    expect(snapshot.sha).toBe(options.sha);
    expect(snapshot.job.correlator).toContain("pnpm-lock.yaml");
    expect(resolved["pkg:npm/markdown-it@14.3.3"]?.dependencies).toContain("pkg:npm/argparse@2.0.1");
  });

  it("refuses partial, duplicated, invalid and missing-reference submissions", () => {
    const bom = {
      metadata: { component: { "bom-ref": "root" } },
      components: [{ purl: "pkg:npm/test@1.0.0", version: "1.0.0", scope: "required" }],
      dependencies: [{ ref: "root", dependsOn: ["pkg:npm/test@1.0.0"] }],
    };
    expect(() => snapshotFromResolvedBom(bom, options)).toThrow(/Incomplete/);
    expect(() => snapshotFromResolvedBom(bom, { ...options, sha: "bad" })).toThrow(/commit SHA/);
    expect(() =>
      snapshotFromResolvedBom({ ...bom, components: [...bom.components, ...bom.components] }, options),
    ).toThrow(/Duplicate/);
    expect(() =>
      snapshotFromResolvedBom(
        { ...bom, dependencies: [{ ref: "root", dependsOn: ["pkg:npm/missing@1.0.0"] }] },
        options,
      ),
    ).toThrow(/child is missing/);
  });
});
