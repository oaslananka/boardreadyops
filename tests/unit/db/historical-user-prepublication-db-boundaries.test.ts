import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkHistoricalUserArchivePrepublication } from "../../../packages/db/src/data-export-historical-object-authorization.js";

type DbEnvelope = unknown;
function artifact() {
  return {
    artifactId: randomUUID(),
    repositoryId: randomUUID(),
    runId: randomUUID(),
    storagePath: `artifacts/${randomUUID()}.bin`,
    sha256: "a".repeat(64),
    byteLength: 1024,
    retentionUntil: new Date(Date.now() + 86400000).toISOString(),
  };
}
function manifestRow(item: ReturnType<typeof artifact>) {
  return {
    artifact_id: item.artifactId,
    run_id: item.runId,
    repository_id: item.repositoryId,
    storage_path: item.storagePath,
    sha256: item.sha256,
    bytes: item.byteLength,
    retention_until: new Date(item.retentionUntil),
    retention_safe: true,
    queued_for_deletion: false,
    unlink_in_progress: false,
  };
}
function fixture(
  evidence: {
    owner?: DbEnvelope;
    advisory?: DbEnvelope;
    hold?: DbEnvelope;
    erasure?: DbEnvelope;
    manifest?: DbEnvelope;
    objects?: ReturnType<typeof artifact>[];
  } = {},
) {
  const query = vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("LOCK TABLE public.legal_holds")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return evidence.owner ?? { rows: [{ tenant_id: "original-user" }] };
    if (sql.includes("pg_advisory_xact_lock")) return evidence.advisory ?? { rows: [{ pg_advisory_xact_lock: "" }] };
    if (sql.includes("SELECT 1 FROM public.legal_holds")) return evidence.hold ?? { rows: [] };
    if (sql.includes("SELECT 1 FROM public.erasure_requests")) return evidence.erasure ?? { rows: [] };
    if (sql.includes("SELECT a.id AS artifact_id"))
      return evidence.manifest ?? { rows: (evidence.objects ?? []).map(manifestRow) };
    throw new Error("Unexpected SQL in prepublication fixture");
  });
  const withTransaction = vi.fn(async (callback: (tx: { query: typeof query }) => Promise<unknown>) =>
    callback({ query }),
  );
  const underLock = vi.fn(async () => {});
  const check = () =>
    checkHistoricalUserArchivePrepublication({
      db: { withTransaction } as never,
      authority: { exportId: randomUUID(), verifiedGitHubUserId: 507 },
      objects: evidence.objects ?? [],
      underLock,
    });
  return { check, query, underLock };
}

describe("original USER archive prepublication authorization evidence", () => {
  it("admits a well-formed empty original-user object manifest without releasing customer bytes", async () => {
    const fx = fixture();
    expect(await fx.check()).toBe("eligible");
    expect(fx.underLock).toHaveBeenCalledOnce();
  });

  it.each([
    ["ambiguous original user", { owner: { rows: [{ tenant_id: "original-user" }, { tenant_id: "original-user" }] } }],
    ["missing legal hold result", { hold: {} }],
    ["malformed legal hold result", { hold: { rows: null } }],
    ["extra legal hold rows", { hold: { rows: [{ "?column?": 1 }, { "?column?": 1 }] } }],
    ["missing real erasure result", { erasure: {} }],
    ["malformed real erasure result", { erasure: { rows: null } }],
    ["extra real erasure rows", { erasure: { rows: [{ "?column?": 1 }, { "?column?": 1 }] } }],
    ["unacknowledged advisory fence", { advisory: { rows: [] } }],
  ] as const)("denies source-only archive prepublication on %s", async (_name, evidence) => {
    const fx = fixture(evidence);
    expect(await fx.check()).toBe("stale");
    expect(fx.underLock).not.toHaveBeenCalled();
  });

  it("rejects duplicate manifest rows that impersonate a missing expected artifact", async () => {
    const first = artifact();
    const second = artifact();
    const fx = fixture({
      objects: [first, second],
      manifest: { rows: [manifestRow(first), manifestRow(first)] },
    });
    expect(await fx.check()).toBe("stale");
    expect(fx.underLock).not.toHaveBeenCalled();
  });

  it("admits a complete two-object manifest with distinct original-user artifact identities", async () => {
    const objects = [artifact(), artifact()];
    const fx = fixture({ objects, manifest: { rows: objects.map(manifestRow) } });
    expect(await fx.check()).toBe("eligible");
    expect(fx.underLock).toHaveBeenCalledOnce();
  });

  it("still reports a valid active hold as held, not eligible", async () => {
    const fx = fixture({ hold: { rows: [{ "?column?": 1 }] } });
    expect(await fx.check()).toBe("held");
    expect(fx.underLock).not.toHaveBeenCalled();
  });

  it("still reports a valid real erasure as stale, not eligible", async () => {
    const fx = fixture({ erasure: { rows: [{ "?column?": 1 }] } });
    expect(await fx.check()).toBe("stale");
    expect(fx.underLock).not.toHaveBeenCalled();
  });
});
