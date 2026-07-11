import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const workflowPath = join(process.cwd(), ".github/workflows/publish-npm.yml");
const packJsonExpression = ["$", "{pack_json}"].join("");

describe("publish-npm workflow contract", () => {
  it("validates the release tarball with direct npm pack instead of the tag's size script", async () => {
    const workflow = await readFile(workflowPath, "utf8");
    const verificationBlock = workflow.slice(
      workflow.indexOf("- name: Verify release package"),
      workflow.indexOf("- name: Attest provenance"),
    );

    expect(verificationBlock).toContain(`npm pack --dry-run --json > "${packJsonExpression}"`);
    expect(verificationBlock).toContain(`PACK_JSON="${packJsonExpression}" node`);
    expect(verificationBlock).toContain('"dist/cli/index.cjs"');
    expect(verificationBlock).toContain('"dist/action/index.cjs"');
    expect(verificationBlock).toContain("Object.values(parsed ?? {}).filter");
    expect(verificationBlock).toContain("metadata candidates");
    expect(verificationBlock).toContain("pack.unpackedSize");
    expect(verificationBlock).not.toContain("pnpm run check:size");
  });

  it("keeps publish idempotency and stable floating-tag gating", async () => {
    const workflow = await readFile(workflowPath, "utf8");

    expect(workflow).toContain("is already published; skipping npm publish");
    expect(workflow).toContain("release_allows_floating_tags == 'true'");
    expect(workflow).toContain("release_is_prerelease == 'false'");
  });
});
