import { describe, expect, it, vi } from "vitest";
import type { SqlQueryExecutor } from "../../../packages/db/src/lifecycle-store.js";
import { ProtectedReleaseIntentStore } from "../../../packages/db/src/protected-release-intent-store.js";

const evidence = {
  version: 2 as const,
  githubOwnerId: 901,
  kind: "protected-branch" as const,
  installationId: 501,
  repositoryId: "repo-internal",
  githubRepositoryId: 601,
  actorGithubUserId: 701,
  actorLogin: "maintainer",
  ref: "refs/heads/main",
  sha: "a".repeat(40),
  requestId: "request-123456",
  digest: "b".repeat(64),
};
const context = {
  internalInstallationId: "installation-internal",
  githubInstallationId: 501,
  observedAt: new Date("2026-10-13T07:00:00Z"),
};

describe("protected-release evidence candidate store (never enqueues)", () => {
  it("re-binds distinct internal and GitHub installation IDs in one database call", async () => {
    const calls: Array<{ sql: string; params: readonly unknown[] }> = [];
    const executor: SqlQueryExecutor = {
      async query(sql, params = []) {
        calls.push({ sql, params });
        return { rows: [{ candidate_id: "saved", inserted: true }] };
      },
    };
    const store = new ProtectedReleaseIntentStore(executor);
    await expect(store.record(evidence, context)).resolves.toEqual({ id: "saved", inserted: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.sql).toContain("boardreadyops_record_protected_release_intent_candidate_v2");
    expect(calls[0]?.sql).not.toContain("release_runs");
    expect(calls[0]?.sql).not.toContain("outbox");
    expect(calls[0]?.params).toEqual([
      "installation-internal",
      "repo-internal",
      501,
      601,
      901,
      701,
      "maintainer",
      "refs/heads/main",
      "a".repeat(40),
      "request-123456",
      "b".repeat(64),
      "2026-10-13T07:00:00.000Z",
    ]);
  });

  it("reports a reused identical request without mutating its existing evidence", async () => {
    const store = new ProtectedReleaseIntentStore({
      async query() {
        return { rows: [{ candidate_id: "saved", inserted: false }] };
      },
    });
    await expect(store.record(evidence, context)).resolves.toEqual({ id: "saved", inserted: false });
  });

  it.each([
    ["different GitHub installation", evidence, { ...context, githubInstallationId: 999 }],
    ["missing internal installation", evidence, { ...context, internalInstallationId: "" }],
    ["invalid repository ID", { ...evidence, githubRepositoryId: 0 }, context],
    ["invalid owner ID", { ...evidence, githubOwnerId: -2 }, context],
    ["invalid actor ID", { ...evidence, actorGithubUserId: -1 }, context],
    ["PR code ref", { ...evidence, ref: "refs/pull/9/merge" }, context],
    ["invalid SHA", { ...evidence, sha: "wrong" }, context],
    ["invalid digest", { ...evidence, digest: "wrong" }, context],
    ["invalid request", { ...evidence, requestId: "short" }, context],
  ] as const)("rejects %s before database access", async (_case, candidate, scope) => {
    const query = vi.fn();
    const store = new ProtectedReleaseIntentStore({ query } as unknown as SqlQueryExecutor);
    await expect(store.record(candidate, scope)).rejects.toThrow("Invalid protected-release evidence");
    expect(query).not.toHaveBeenCalled();
  });

  it("rejects missing or malformed database acknowledgements", async () => {
    const store = new ProtectedReleaseIntentStore({
      async query() {
        return { rows: [{ candidate_id: "saved", inserted: "true" }] };
      },
    });
    await expect(store.record(evidence, context)).rejects.toThrow("acknowledgement unavailable");
  });
});
