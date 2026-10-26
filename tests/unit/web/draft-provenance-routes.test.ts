import { describe, expect, it, vi } from "vitest";
import {
  type DraftProvenanceRouteDependencies,
  handleDraftProvenanceStatus,
} from "../../../apps/web/lib/draft-provenance-routes.js";

const runId = "22222222-2222-4222-8222-222222222222";
const installationId = "11111111-1111-4111-8111-111111111111";
const attemptId = "33333333-3333-4333-8333-333333333333";

function fixture() {
  const authorizeInstallation = vi.fn(async () => true);
  const authorize = vi.fn(async () => ({ session: {}, authorizeInstallation }));
  const query = vi.fn(async () => ({
    rows: [{ installation_id: installationId, execution_attempt_id: attemptId }],
  }));
  const close = vi.fn(async () => {});
  const openExecutor = vi.fn(() => ({ query, close }));
  const verify = vi.fn(async () => ({
    status: "verified-runner-claim" as const,
    archiveArtifactId: "55555555-5555-4555-8555-555555555555",
    receiptArtifactId: "66666666-6666-4666-8666-666666666666",
    archiveSha256: "a".repeat(64),
  }));
  const deps = {
    authorize,
    openExecutor,
    verify,
    environment: { ARTIFACT_STORAGE_DRIVER: "local", ARTIFACT_STORAGE_ROOT: "/unused-test-fixture" },
  } as DraftProvenanceRouteDependencies;
  return { deps, authorize, authorizeInstallation, openExecutor, query, close, verify };
}

describe("authenticated, non-authorizing draft provenance status", () => {
  it("requires a session before opening the database or probing runs", async () => {
    const f = fixture();
    f.authorize.mockResolvedValueOnce({ session: undefined, authorizeInstallation: f.authorizeInstallation });
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(result.status).toBe(401);
    expect(f.openExecutor).not.toHaveBeenCalled();
    expect(f.verify).not.toHaveBeenCalled();
  });

  it("refuses malformed identifiers and unavailable persistence", async () => {
    const f = fixture();
    expect((await handleDraftProvenanceStatus("not-uuid", f.deps)).status).toBe(400);
    expect(f.openExecutor).not.toHaveBeenCalled();
    f.openExecutor.mockReturnValueOnce(undefined as never);
    expect((await handleDraftProvenanceStatus(runId, f.deps)).status).toBe(503);
    expect(f.verify).not.toHaveBeenCalled();
  });

  it("does not leak nonexistent or cross-installation runs", async () => {
    const f = fixture();
    f.query.mockResolvedValueOnce({ rows: [] });
    const absent = await handleDraftProvenanceStatus(runId, f.deps);
    expect(absent.status).toBe(404);
    expect(f.authorizeInstallation).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
    f.authorizeInstallation.mockResolvedValueOnce(false);
    const foreign = await handleDraftProvenanceStatus(runId, f.deps);
    expect(foreign.status).toBe(404);
    expect(await foreign.json()).toEqual(await absent.json());
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(2);
  });

  it("does not verify a run without a current authoritative attempt", async () => {
    const f = fixture();
    f.query.mockResolvedValueOnce({ rows: [{ installation_id: installationId, execution_attempt_id: null }] });
    f.query.mockResolvedValueOnce({ rows: [{ installation_id: installationId, execution_attempt_id: null }] });
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(result.status).toBe(200);
    expect(await result.json()).toEqual({ ok: true, status: "unverified", manufacturingApproved: false });
    expect(f.verify).not.toHaveBeenCalled();
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("verifies only after current installation authorization, revealing status only", async () => {
    const f = fixture();
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(result.status).toBe(200);
    expect(result.headers.get("cache-control")).toBe("private, no-store");
    expect(result.headers.get("vary")).toBe("Cookie");
    expect(await result.json()).toEqual({ ok: true, status: "verified-runner-claim", manufacturingApproved: false });
    expect(f.authorizeInstallation).toHaveBeenCalledWith(installationId);
    expect(f.verify).toHaveBeenCalledWith({
      executor: expect.anything(),
      runId,
      executionAttemptId: attemptId,
      storageRoot: "/unused-test-fixture",
      storageDriver: "local",
    });
    expect(f.query).toHaveBeenCalledWith(expect.stringContaining("repositories.id = release_runs.repository_id"), [
      runId,
    ]);
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("rejects a revoked installation after the asynchronous ZIP verifier completes", async () => {
    const f = fixture();
    f.authorizeInstallation.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ ok: false, error: "Run not found" });
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(f.authorizeInstallation).toHaveBeenCalledTimes(2);
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["deleted/disabled repository", []],
    [
      "installation switched",
      [{ installation_id: "44444444-4444-4444-8444-444444444444", execution_attempt_id: attemptId }],
    ],
    [
      "attempt superseded",
      [{ installation_id: installationId, execution_attempt_id: "55555555-5555-4555-8555-555555555555" }],
    ],
  ] as const)("rejects %s before disclosing any verified status", async (_case, latestRows) => {
    const f = fixture();
    f.query.mockResolvedValueOnce({ rows: [{ installation_id: installationId, execution_attempt_id: attemptId }] });
    f.query.mockResolvedValueOnce({ rows: [...latestRows] });
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(result.status).toBe(404);
    expect(await result.json()).toEqual({ ok: false, error: "Run not found" });
    expect(f.verify).toHaveBeenCalledTimes(1);
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("reports unsupported or tampered evidence as unverified, never approved", async () => {
    const f = fixture();
    f.verify.mockResolvedValueOnce({ status: "unverified", reason: "signature" } as never);
    const result = await handleDraftProvenanceStatus(runId, f.deps);
    expect(await result.json()).toEqual({ ok: true, status: "unverified", manufacturingApproved: false });
    expect(f.close).toHaveBeenCalledTimes(1);
  });

  it("fails closed and releases DB resources when a query or verification fails", async () => {
    const f = fixture();
    f.query.mockRejectedValueOnce(new Error("internal database secret"));
    const queryFailure = await handleDraftProvenanceStatus(runId, f.deps);
    expect(queryFailure.status).toBe(503);
    expect(JSON.stringify(await queryFailure.json())).not.toContain("secret");
    f.verify.mockRejectedValueOnce(new Error("internal storage secret"));
    const verifyFailure = await handleDraftProvenanceStatus(runId, f.deps);
    expect(verifyFailure.status).toBe(503);
    expect(JSON.stringify(await verifyFailure.json())).not.toContain("secret");
    expect(f.close).toHaveBeenCalledTimes(2);
  });
});
