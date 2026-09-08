import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const docs = [
  new URL("../../docs/deployment/github-actions-execution.md", import.meta.url),
  new URL("../../docs/security/github-app-permissions.md", import.meta.url),
  new URL("../../docs/configuration.md", import.meta.url),
  new URL("../../docs/product/zero-config-onboarding.md", import.meta.url),
];

describe("repository setup documentation", () => {
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
      "contract-design handoff",
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
