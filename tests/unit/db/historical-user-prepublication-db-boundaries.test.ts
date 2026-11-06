import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { checkHistoricalUserArchivePrepublication } from "../../../packages/db/src/data-export-historical-object-authorization.js";

type DbEnvelope = unknown;
function fixture(
  evidence: { owner?: DbEnvelope; advisory?: DbEnvelope; hold?: DbEnvelope; erasure?: DbEnvelope } = {},
) {
  const query = vi.fn(async (sql: string): Promise<unknown> => {
    if (sql.startsWith("LOCK TABLE public.legal_holds")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) return evidence.owner ?? { rows: [{ tenant_id: "original-user" }] };
    if (sql.includes("pg_advisory_xact_lock")) return evidence.advisory ?? { rows: [{ pg_advisory_xact_lock: "" }] };
    if (sql.includes("SELECT 1 FROM public.legal_holds")) return evidence.hold ?? { rows: [] };
    if (sql.includes("SELECT 1 FROM public.erasure_requests")) return evidence.erasure ?? { rows: [] };
    if (sql.includes("SELECT a.id AS artifact_id")) return { rows: [] };
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
      objects: [],
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
