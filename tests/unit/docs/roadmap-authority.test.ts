import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public roadmap authority contract", () => {
  const repoRoot = resolve(__dirname, "../../../");
  const roadmapPath = resolve(repoRoot, "docs/ROADMAP.md");
  const masterStatusPath = resolve(repoRoot, "docs/development/master-execution-status.md");

  it("keeps the public roadmap concise and points to the two canonical authorities", () => {
    const roadmap = readFileSync(roadmapPath, "utf8");

    expect(roadmap).toContain("canonical product roadmap");
    expect(roadmap).toContain("issues/758");
    expect(roadmap).toContain("canonical repository, cloud, GitHub App, execution, security, and delivery roadmap");
    expect(roadmap).toContain("issues/191");
    expect(roadmap).toContain("not** a third roadmap authority");
    expect(roadmap).not.toContain("Epic #261");
    expect(roadmap).not.toContain("Epic #277");
  });

  it("keeps the engineering ledger explicitly scoped to delivery while linking product sequencing", () => {
    const status = readFileSync(masterStatusPath, "utf8");

    expect(status).toContain("**Product Sequencing:** Issue [#758]");
    expect(status).toContain("**Delivery Sequencing:** Issue [#191]");
  });
});
