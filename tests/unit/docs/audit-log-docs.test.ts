import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const documentationUrl = new URL("../../../docs/security/audit-logs.md", import.meta.url);

describe("audit log documentation", () => {
  it("documents the authenticated tenant-scoped export contract", async () => {
    const documentation = await readFile(documentationUrl, "utf8");
    expect(documentation).toContain("/api/v1/operator/installations/{installationId}/audit-events");
    expect(documentation).toContain("BOARDREADYOPS_OPERATOR_API_TOKEN");
    expect(documentation).toContain("opaque `cursor`");
    expect(documentation).toContain("metadata allowlist");
    expect(documentation).toContain("`repositoryId`");
    expect(documentation).toContain("`releaseRunId`");
    expect(documentation).toContain("`eventType`");
  });
});
