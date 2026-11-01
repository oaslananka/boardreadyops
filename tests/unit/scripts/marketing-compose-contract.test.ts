import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../../../deploy/docker-compose.marketing.yml", import.meta.url), "utf8");
const docs = readFileSync(new URL("../../../docs/deployment/marketing-surface.md", import.meta.url), "utf8");

describe("optional independent marketing runtime", () => {
  it("uses a separate project and source-SHA image pin, with no SaaS database/worker/credentials", () => {
    expect(source).toContain("name: boardreadyops-marketing");
    expect(source).toContain("BOARDREADYOPS_MARKETING_IMAGE_TAG");
    expect(source).toContain("BOARDREADYOPS_SITE_SURFACE: marketing");
    expect(source).toContain("127.0.0.1:");
    expect(source).toContain("/api/health/live");
    expect(source).not.toMatch(/\bDATABASE_URL\s*:/);
    expect(source).not.toMatch(/\bPOSTGRES_PASSWORD\s*:/);
    expect(source).not.toMatch(/\benv_file\s*:/);
    expect(source).not.toMatch(/\bworker\s*:/);
    expect(source).not.toMatch(/\bpostgres\s*:/);
  });
  it("documents an opt-in independent rollout without claiming a commissioned production hostname", () => {
    expect(docs).toContain("opt-in deployment mode");
    expect(docs).toContain("current production hostname and");
    expect(docs).toContain("independently by pinning");
    expect(docs).toContain("not proof of a");
  });
});
