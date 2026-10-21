import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import {
  type ProtectedReleaseExecutionSealRequest,
  ProtectedReleaseExecutionSealStore,
} from "../../../packages/db/src/protected-release-execution-seal-store.js";

const request: ProtectedReleaseExecutionSealRequest = {
  candidateId: "11111111-1111-4111-8111-111111111111",
  internalInstallationId: "22222222-2222-4222-8222-222222222222",
  internalRepositoryId: "33333333-3333-4333-8333-333333333333",
  githubInstallationId: 501,
  githubRepositoryId: 601,
  actorGithubUserId: 701,
  reservedRunId: "44444444-4444-4444-8444-444444444444",
  reservedAttemptId: "55555555-5555-4555-8555-555555555555",
};
const id = "66666666-6666-4666-8666-666666666666";
const fingerprint = "b".repeat(64);
const observedAt = new Date("2026-10-13T08:59:00Z");

describe("non-executable protected execution identity store", () => {
  it("seals tenant, GitHub identity and exact reserved run/attempt in one SQL call", async () => {
    const calls: Array<{ query: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(query, params = []) {
        calls.push({ query, params });
        return { rows: [{ seal_id: id, seal_digest: fingerprint, inserted: true }] };
      },
    };
    const sealed = await new ProtectedReleaseExecutionSealStore(executor).seal(request, observedAt);
    expect(sealed).toEqual({ id, digest: fingerprint, inserted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toContain("boardreadyops_seal_protected_release_identity");
    expect(calls[0]?.query).not.toMatch(/insert into|release_runs|control_plane_outbox|runner_job_leases/iu);
    expect(calls[0]?.params).toEqual([
      request.candidateId,
      request.internalInstallationId,
      request.internalRepositoryId,
      501,
      601,
      701,
      request.reservedRunId,
      request.reservedAttemptId,
      observedAt.toISOString(),
    ]);
  });

  it("reports an identical SQL retry without minting a second record", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return { rows: [{ seal_id: id, seal_digest: fingerprint, inserted: false }] };
      },
    };
    await expect(new ProtectedReleaseExecutionSealStore(executor).seal(request, observedAt)).resolves.toEqual({
      id,
      digest: fingerprint,
      inserted: false,
    });
  });

  it.each([
    ["candidate", { ...request, candidateId: "forged" }],
    ["installation", { ...request, internalInstallationId: "not-a-uuid" }],
    ["repository", { ...request, internalRepositoryId: "" }],
    ["GitHub installation", { ...request, githubInstallationId: -2 }],
    ["GitHub repository", { ...request, githubRepositoryId: 0 }],
    ["actor", { ...request, actorGithubUserId: 0 }],
    ["run", { ...request, reservedRunId: "bad" }],
    ["attempt", { ...request, reservedAttemptId: "bad" }],
    ["same run/attempt", { ...request, reservedAttemptId: request.reservedRunId }],
  ])("rejects malformed %s before database access", async (_name, malformed) => {
    const query = vi.fn();
    await expect(
      new ProtectedReleaseExecutionSealStore({ query } as unknown as SqlQueryExecutor).seal(malformed, observedAt),
    ).rejects.toThrow("Invalid non-executable");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects forged SQL acknowledgements", async () => {
    const executor: SqlQueryExecutor = {
      async query() {
        return { rows: [{ seal_id: id, seal_digest: "wrong", inserted: true }] };
      },
    };
    await expect(new ProtectedReleaseExecutionSealStore(executor).seal(request, observedAt)).rejects.toThrow(
      "acknowledgement unavailable",
    );
  });

  it("rejects invalid timestamps before database access", async () => {
    const query = vi.fn();
    await expect(
      new ProtectedReleaseExecutionSealStore({ query } as unknown as SqlQueryExecutor).seal(request, new Date("bad")),
    ).rejects.toThrow("Invalid non-executable");
    expect(query).not.toHaveBeenCalled();
  });
});
