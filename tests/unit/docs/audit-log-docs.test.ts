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
    expect(documentation).toContain("database-owned cascade");
    expect(documentation).toContain("parent installation");
    expect(documentation).toContain("does not expose installation erasure");
    expect(documentation).toContain("`repositoryId`");
    expect(documentation).toContain("`releaseRunId`");
    expect(documentation).toContain("`eventType`");
  });
  it("documents fail-closed signed artifact access auditing", async () => {
    const documentation = await readFile(documentationUrl, "utf8");
    expect(documentation).toContain("`artifact.download.started`");
    expect(documentation).toContain("actor type `signed_url`");
    expect(documentation).toContain("returns a stable `503` response without serving bytes");
    expect(documentation).toContain("does not claim that");
    expect(documentation).toContain("the client received every byte");
    expect(documentation).toContain("URL signatures");
    expect(documentation).toContain("IP addresses");
  });
  it("documents atomic artifact record deletion and durable physical deletion evidence", async () => {
    const documentation = await readFile(documentationUrl, "utf8");
    expect(documentation).toContain("`artifact.record.deleted`");
    expect(documentation).toContain("same PostgreSQL statement");
    expect(documentation).toContain("kept as the subject ID");
    expect(documentation).toContain("Artifact names");
    expect(documentation).toContain("storage paths");
    expect(documentation).toContain("surrounding result transaction rolls back");
    expect(documentation).toContain("durable physical-deletion job");
    expect(documentation).toContain("`artifact.object.deleted`");
    expect(documentation).toContain("`outcome=deleted`");
    expect(documentation).toContain("`outcome=missing`");
    expect(documentation).toContain("unsupported storage drivers");
    expect(documentation).toContain("general age-based artifact expiry");
    expect(documentation).toContain("data-lifecycle.md");
  });
  it("documents privacy-safe release decision reconstruction", async () => {
    const documentation = await readFile(documentationUrl, "utf8");
    expect(documentation).toContain("`runner.result.persisted`");
    expect(documentation).toContain("versioned, privacy-safe");
    expect(documentation).toContain("GitHub Check conclusion");
    expect(documentation).toContain("active/expired/stale waiver counts");
    expect(documentation).toContain("Finding messages, waiver owners");
    expect(documentation).toContain("does not expose waiver");
    expect(documentation).toContain("content. Policy preset");
    expect(documentation).toContain("without changing the existing result-digest replay contract");
    expect(documentation).not.toContain("complete release-decision reconstruction tests");
  });
  it("documents retry-safe GitHub lifecycle auditing without pull-request noise", async () => {
    const documentation = await readFile(documentationUrl, "utf8");
    expect(documentation).toContain("`github_app.installation.enabled`");
    expect(documentation).toContain("`github_app.installation.suspended`");
    expect(documentation).toContain("`github_app.installation.unsuspended`");
    expect(documentation).toContain("`github_app.repository.disabled`");
    expect(documentation).toContain("actor type `github_webhook`");
    expect(documentation).toContain("Event IDs are derived");
    expect(documentation).toContain("deterministically from the delivery");
    expect(documentation).toContain("`pull_request` events do not produce enablement audit entries");
    expect(documentation).toContain("`repositoryPrivate`");
    expect(documentation).toContain("webhook signatures");
    expect(documentation).toContain("payload bodies");
    expect(documentation).toContain("state transition actually changes `suspended_at`");
    expect(documentation).not.toContain("remains open for installation suspension/unsuspension coverage");
  });
});
