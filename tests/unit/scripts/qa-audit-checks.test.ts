import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const checksPath = "qa/audit/checks.ts";
const auditSpecPath = "tests/e2e/qa-audit.spec.ts";

describe("QA audit contracts", () => {
  it("scopes internal-link requests to each route's expected prefixes", async () => {
    const [checks, auditSpec] = await Promise.all([readFile(checksPath, "utf8"), readFile(auditSpecPath, "utf8")]);

    expect(checks).toContain("expectedLinkPrefixes: readonly string[] = []");
    expect(checks).toContain("expected.some((expectedPrefix) => path.startsWith(expectedPrefix))");
    expect(auditSpec).toContain("checkInternalLinks(page, origin, route.expectedLinkPrefixes)");
  });

  it("does not allowlist 401s now that QA sessions are deterministic", async () => {
    const checks = await readFile(checksPath, "utf8");

    expect(checks).not.toContain('"the server responded with a status of 401"');
    expect(checks).toContain('"the server responded with a status of 404"');
  });
});
