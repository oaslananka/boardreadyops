import { randomUUID } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prepareVerifiedHistoricalUserCompositePreflight } from "../../../packages/db/src/data-export-historical-inventory.js";
import { checkHistoricalUserArchivePrepublication } from "../../../packages/db/src/data-export-historical-object-authorization.js";

vi.mock("../../../packages/db/src/data-export-historical-inventory.js", () => ({
  prepareVerifiedHistoricalUserCompositePreflight: vi.fn(),
  prepareVerifiedHistoricalUserConsistentCorePreflight: vi.fn(),
  prepareVerifiedHistoricalUserPrivateVisualEvidence: vi.fn(),
}));

const snapshot = vi.mocked(prepareVerifiedHistoricalUserCompositePreflight);
const a = "a".repeat(64);
const b = "b".repeat(64);
const c = "c".repeat(64);
const d = "d".repeat(64);
const e = "e".repeat(64);

const evidence = (coreSha256: string, epochSha256 = d) => ({
  core: { sha256: coreSha256, byteLength: 64 },
  visual: { sha256: c, byteLength: 64, visualCount: 0 },
  mutationEpochSha256: epochSha256,
});

function fixture(onOwnerRead?: () => void) {
  const query = vi.fn(async (sql: string) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id")) {
      onOwnerRead?.();
      return { rows: [{ tenant_id: "original-user" }] };
    }
    if (sql.includes("pg_advisory_xact_lock")) return { rows: [{ pg_advisory_xact_lock: "" }] };
    if (sql.includes("SELECT 1 FROM public.legal_holds")) return { rows: [] };
    if (sql.includes("SELECT 1 FROM public.erasure_requests")) return { rows: [] };
    if (sql.includes("SELECT a.id AS artifact_id")) return { rows: [] };
    throw new Error("Unexpected historical-user source-only prepublication SQL");
  });
  const withTransaction = vi.fn(async (work: (tx: { query: typeof query }) => Promise<unknown>) => work({ query }));
  const input = {
    db: { withTransaction } as never,
    authority: { exportId: randomUUID(), verifiedGitHubUserId: 407 },
    objects: [],
    expectedCore: { sha256: a, byteLength: 64 },
    expectedVisual: { sha256: c, byteLength: 64, visualCount: 0 },
    expectedMutationEpochSha256: d,
    underLock: vi.fn(async () => {}),
  };
  return { input, query, withTransaction };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("source-only original USER prepublication evidence remains bound across DB locks and physical IO", () => {
  it("rejects a caller who replaces the original core/epoch digests after owner validation", async () => {
    let mutate = () => {};
    const { input } = fixture(() => mutate());
    mutate = () => {
      input.expectedCore = { sha256: b, byteLength: 64 };
      input.expectedMutationEpochSha256 = e;
    };
    snapshot.mockResolvedValue(evidence(b, e) as never);
    expect(await checkHistoricalUserArchivePrepublication(input)).toBe("stale");
    expect(input.underLock).not.toHaveBeenCalled();
  });

  it("rejects post-IO source changes even if the caller updates the expected digest mid-transfer", async () => {
    const { input } = fixture();
    let readCount = 0;
    snapshot.mockImplementation(async () => evidence(++readCount === 1 ? a : b) as never);
    input.underLock = vi.fn(async () => {
      // The independent source changed. Caller must not redefine the
      // already-accepted ZIP receipt before the final committed check.
      input.expectedCore.sha256 = b;
    });
    expect(await checkHistoricalUserArchivePrepublication(input)).toBe("stale");
    expect(input.underLock).toHaveBeenCalledOnce();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it("cannot substitute a different filesystem write callback while database locks are awaited", async () => {
    let mutate = () => {};
    const { input } = fixture(() => mutate());
    const initiallyTrusted = input.underLock;
    const forged = vi.fn(async () => {});
    mutate = () => {
      input.underLock = forged;
    };
    snapshot.mockResolvedValue(evidence(a) as never);
    expect(await checkHistoricalUserArchivePrepublication(input)).toBe("eligible");
    expect(initiallyTrusted).toHaveBeenCalledOnce();
    expect(forged).not.toHaveBeenCalled();
  });
});
