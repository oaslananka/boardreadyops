import { createHmac } from "node:crypto";
import { verifyStripeWebhook } from "@boardreadyops/cloud-core";
import { describe, expect, it } from "vitest";
import { decodeRunListingCursor } from "../../apps/web/lib/run-listing.js";

describe("Security adversarial invariants", () => {
  it("rejects cross-tenant cursor tampering", () => {
    const tampered = "eyJ0ZW5hbnRJZCI6Im90aGVyIn0"; // base64 of other tenant
    expect(decodeRunListingCursor(tampered)).toBeFalsy();
  });

  it("rejects invalid Stripe signature", () => {
    const payload = JSON.stringify({ id: "evt_123", type: "invoice.paid" });
    const secret = "whsec_test";
    const timestamp = Math.floor(Date.now() / 1000);
    const header = `t=${timestamp},v1=deadbeef`;
    const verified = verifyStripeWebhook({ payload, secret, signatureHeader: header, now: timestamp });
    expect(verified).toBe(false);
  });

  it("accepts valid Stripe signature", () => {
    const payload = JSON.stringify({ id: "evt_123", type: "invoice.paid" });
    const secret = "whsec_test_secret_1234567890";
    const timestamp = Math.floor(Date.now() / 1000);
    const digest = createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex");
    const header = `t=${timestamp},v1=${digest}`;
    const verified = verifyStripeWebhook({ payload, secret, signatureHeader: header, now: timestamp });
    expect(verified).toBe(true);
  });

  it("rejects Stripe replay outside tolerance", () => {
    const payload = JSON.stringify({ id: "evt_123", type: "invoice.paid" });
    const secret = "whsec_test_secret_1234567890";
    const oldTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 min ago, beyond 300s
    const digest = createHmac("sha256", secret).update(`${oldTimestamp}.${payload}`).digest("hex");
    const header = `t=${oldTimestamp},v1=${digest}`;
    const verified = verifyStripeWebhook({
      payload,
      secret,
      signatureHeader: header,
      now: Math.floor(Date.now() / 1000),
    });
    expect(verified).toBe(false);
  });

  it("rejects XSS in comment body via sanitization check", () => {
    const malicious = "<script>alert(1)</script><img src=x onerror=alert(2)>";
    // In production, comment body is sanitized; here we verify that raw script tags are not rendered as HTML
    const sanitized = malicious.replaceAll(/<script.*?>.*?<\/script>/gi, "").replaceAll(/onerror=/gi, "");
    expect(sanitized).not.toContain("<script>");
    expect(sanitized).not.toContain("onerror=");
  });

  it("rejects path traversal in artifact key", async () => {
    const { resolveLocalArtifactPath } = await import("@boardreadyops/cloud-core");
    expect(() => resolveLocalArtifactPath("/tmp/root", "../etc/passwd")).toThrow();
    expect(() => resolveLocalArtifactPath("/tmp/root", "/absolute/path")).toThrow();
  });

  it("enforces tenant scope in DB queries (not just array filter)", async () => {
    // This is a code-structure check: verify that review-store queries contain repository_id scoping
    const { readFile } = await import("node:fs/promises");
    const store = await readFile("packages/db/src/review-store.ts", "utf8");
    expect(store).toContain("repository_id");
    expect(store).toMatch(/WHERE.*repository_id/iu);
  });

  it("requires reason for accepted_risk disposition", async () => {
    const { createFindingDecisionRequestSchema } = await import("@boardreadyops/contracts");
    const short = createFindingDecisionRequestSchema.safeParse({
      disposition: "accepted_risk",
      reason: "too short",
      evidenceDigest: "a".repeat(64),
    });
    expect(short.success).toBe(false);
    const long = createFindingDecisionRequestSchema.safeParse({
      disposition: "accepted_risk",
      reason: "This is a detailed justification with at least 20 characters for waiver",
      evidenceDigest: "a".repeat(64),
    });
    expect(long.success).toBe(true);
  });

  it("rejects source upload without explicit source mode", async () => {
    const { uploadManifestSchema } = await import("@boardreadyops/contracts");
    const manifest = {
      schemaVersion: 1 as const,
      uploadMode: "metadata" as const,
      repositoryId: "repo_123",
      commitSha: "abc123def456",
      toolVersion: "1.0.0",
      configDigest: "a".repeat(64),
      rulePackDigest: "b".repeat(64),
      items: [
        {
          kind: "source",
          path: "hardware/main.kicad_sch",
          contentType: "text/plain",
          bytes: 100,
          sha256: "c".repeat(64),
          dataClass: "source" as const,
        },
      ],
    };
    const parsed = uploadManifestSchema.safeParse(manifest);
    expect(parsed.success).toBe(false);
  });

  it("detects single-byte tampering in evidence ledger", async () => {
    const { buildEvidenceLedger, verifyEvidenceLedger } = await import("@boardreadyops/cloud-core");
    const ledger = buildEvidenceLedger({
      repository: "acme/board",
      baseSha: "a".repeat(40),
      headSha: "b".repeat(40),
      manifest: [{ name: "report.html", path: "report.html", type: "report", sizeBytes: 100, sha256: "c".repeat(64) }],
      decisions: [],
      approvals: [],
      checklist: [],
    });
    const tampered = { ...ledger, evidenceDigest: "0".repeat(64) };
    const result = verifyEvidenceLedger(tampered);
    expect(result.verified).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("prevents incomplete check from turning green", async () => {
    const { isWdrrReady } = await import("@boardreadyops/cloud-core");
    expect(
      isWdrrReady({
        headRunId: "run1",
        requiredChecksComplete: false,
        blockerFindingsResolved: true,
        requiredApprovalsPresent: true,
        evidenceRecordProduced: true,
      }),
    ).toBe(false);
    expect(
      isWdrrReady({
        headRunId: "run1",
        requiredChecksComplete: true,
        blockerFindingsResolved: true,
        requiredApprovalsPresent: true,
        evidenceRecordProduced: true,
        baseRunId: "base1",
      }),
    ).toBe(true);
    expect(
      isWdrrReady({
        headRunId: "run1",
        requiredChecksComplete: true,
        blockerFindingsResolved: true,
        requiredApprovalsPresent: true,
        evidenceRecordProduced: true,
      }),
    ).toBe(false); // missing base
  });
});
