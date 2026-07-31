import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

const lifecycleUrl = new URL("../../../docs/security/data-lifecycle.md", import.meta.url);
const auditUrl = new URL("../../../docs/security/audit-logs.md", import.meta.url);
const navigationUrl = new URL("../../../mkdocs.yml", import.meta.url);

describe("data lifecycle documentation", () => {
  it("documents the implemented storage boundaries and lifecycle matrix without overclaiming erasure", async () => {
    const lifecycle = await readFile(lifecycleUrl, "utf8");

    expect(lifecycle).toContain("BoardReadyOps does not persist the raw GitHub webhook body");
    expect(lifecycle).toContain("BOARDREADYOPS_WEBHOOK_RETENTION_DAYS");
    expect(lifecycle).toContain("BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS");
    expect(lifecycle).toContain("30 days");
    expect(lifecycle).toContain("normalized actions are replaced with an empty array");
    expect(lifecycle).toContain("raw normalized runner result payload");
    expect(lifecycle).toContain("No automatic age-based purge");
    expect(lifecycle).toContain("append-only");
    expect(lifecycle).toContain("ARTIFACT_STORAGE_DRIVER=local");
    expect(lifecycle).toContain("replaced by a newer accepted result");
    expect(lifecycle).toContain("General age-based artifact expiry is not implemented");
    expect(lifecycle).toContain("15 minutes");
    expect(lifecycle).toContain("Plaintext capability, lease, enrollment, and nonce secrets are not persisted");
    expect(lifecycle).toContain("Expired runner request nonce digests are removed periodically in bounded batches");
    expect(lifecycle).toContain("Pending artifact upload capabilities are marked expired");
    expect(lifecycle).toContain("unconsumed enrollment tokens are revoked");
    expect(lifecycle).toContain("terminal artifact capability");
    expect(lifecycle).toContain("does not remove release runs");
    expect(lifecycle).toContain("GitHub Actions execution boundary");
    expect(lifecycle).toContain("Customer self-hosted runner boundary");
    expect(lifecycle).toContain("Private repository run dashboards fail closed");
    expect(lifecycle).toContain("repository authorization");
    expect(lifecycle).toContain("organization, repository, or user erasure workflow is not implemented");
    expect(lifecycle).toContain("legal-hold workflow is not implemented");
    expect(lifecycle).toContain("backup and platform-log expiry remain operator responsibilities");
  });

  it("keeps lifecycle navigation and audit claims aligned with physical deletion", async () => {
    const navigation = await readFile(navigationUrl, "utf8");
    const audit = await readFile(auditUrl, "utf8");

    expect(navigation).toContain("Data Lifecycle and Privacy: security/data-lifecycle.md");
    expect(audit).toContain("`artifact.object.deleted`");
    expect(audit).toContain("`outcome=missing`");
    expect(audit).toContain("durable physical-deletion job");
    expect(audit).toContain("general age-based artifact expiry");
    expect(audit).not.toContain("Issue #43 remains open");
    expect(audit).toContain("Issue #44 remains open");
  });
});
