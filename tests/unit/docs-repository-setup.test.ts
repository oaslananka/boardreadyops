import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { declaredPermissionRecord } from "../../packages/cloud-core/src/github-capabilities.js";

const docs = [
  new URL("../../docs/deployment/github-actions-execution.md", import.meta.url),
  new URL("../../docs/security/github-app-permissions.md", import.meta.url),
  new URL("../../docs/configuration.md", import.meta.url),
  new URL("../../docs/product/zero-config-onboarding.md", import.meta.url),
];

describe("repository setup documentation", () => {
  it("matches the authoritative scoped setup-PR permission model (#446)", async () => {
    const record = declaredPermissionRecord();
    expect(record.contents).toBe("write");
    expect(record.workflows).toBe("write");
    expect(record.pull_requests).toBe("write");

    const content = await readFile(new URL("../../docs/product/zero-config-onboarding.md", import.meta.url), "utf8");
    expect(content).toContain("`contents: write`, `workflows: write`, and `pull_requests: write`");
    expect(content).toContain("the App never writes to the default branch");
    expect(content).toContain("copy-ready manual instructions");
    expect(content).toContain("first actionable finding");
    expect(content).toContain("under 10 minutes");
    expect(content).not.toContain("least-privilege alternative to granting the GitHub App Contents write");
    expect(content).not.toContain("Do not grant the App Contents write");
  });
  it("distinguishes immediate permission reduction from approval-gated expansion", async () => {
    const content = await readFile(new URL("../../docs/security/github-app-permissions.md", import.meta.url), "utf8");
    const normalized = content.replace(/\s+/g, " ").toLowerCase();

    expect(normalized).toContain("permission and webhook removals take effect immediately");
    expect(normalized).toContain("new or broader permissions require installation-owner approval");
    expect(normalized).not.toContain("re-authorize installations after changing requested permissions.");
  });

  it("documents presets, least privilege, OIDC validation, history and failure states", async () => {
    const content = (await Promise.all(docs.map((document) => readFile(document, "utf8")))).join("\n");
    for (const phrase of [
      "open-source hardware",
      "prototype fabrication",
      "production release",
      "historical preset id",
      "Contents write",
      "setup revision",
      "GitHub Actions OIDC",
      "missing configuration",
      "invalid configuration",
      "/api/v1/setup-probes/result",
      "setup url",
      "untrusted `installation_id`",
      "first-result telemetry",
    ]) {
      expect(content.toLowerCase()).toContain(phrase.toLowerCase());
    }
  });
});
