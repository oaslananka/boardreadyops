import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { DataExportArchiveCommitmentStore } from "../../../packages/db/src/data-export-archive-commitment-store.js";

const originalRequester = () => ({
  exportId: randomUUID(),
  tenantId: "original-tenant",
  installationId: randomUUID(),
  actorLogin: "original-owner",
});

describe("archive commitment original-requester DB acknowledgements", () => {
  it("denies revocation success if the persisted export acknowledgement is unrelated or malformed", async () => {
    const request = originalRequester();
    for (const rows of [
      [{ export_id: randomUUID() }],
      [{}],
      [null],
      [request.exportId],
      [],
      [{ export_id: request.exportId }, { export_id: request.exportId }],
      { length: 1 },
    ]) {
      const query = vi.fn().mockResolvedValue({ rows });
      const store = new DataExportArchiveCommitmentStore({ query } as never);
      expect(await store.revokeForRequester(request)).toBe(false);
      expect(query).toHaveBeenCalledTimes(1);
    }
  });

  it("accepts only the matching single original-requester revoke acknowledgement", async () => {
    const request = originalRequester();
    const query = vi.fn().mockResolvedValue({ rows: [{ export_id: request.exportId }] });
    const store = new DataExportArchiveCommitmentStore({ query } as never);
    expect(await store.revokeForRequester(request)).toBe(true);
    expect(query.mock.calls[0]?.[1]).toEqual([
      request.exportId,
      request.tenantId,
      request.installationId,
      request.actorLogin,
    ]);
  });

  it("rejects malformed cleanup acknowledgement rather than declaring physical cleanup complete", async () => {
    const request = originalRequester();
    for (const rows of [
      [{ export_id: randomUUID() }],
      [null],
      [{}],
      [],
      [{ export_id: request.exportId }, { export_id: request.exportId }],
      { length: 1 },
    ]) {
      const query = vi.fn().mockResolvedValue({ rows });
      const store = new DataExportArchiveCommitmentStore({ query } as never);
      await expect(store.markPhysicallyCleaned(request, "deleted")).rejects.toThrow(
        "Archive cleanup transaction lost eligibility",
      );
    }
  });

  it("accepts exactly the requested cleanup acknowledgement", async () => {
    const request = originalRequester();
    const query = vi.fn().mockResolvedValue({ rows: [{ export_id: request.exportId }] });
    const store = new DataExportArchiveCommitmentStore({ query } as never);
    await expect(store.markPhysicallyCleaned(request, "missing")).resolves.toBeUndefined();
  });

  it("rejects malformed untrusted archive operations without querying a tenant database", async () => {
    const query = vi.fn();
    const store = new DataExportArchiveCommitmentStore({ query } as never);
    const requester = originalRequester();
    const claim = { ...requester, workerId: "safe-worker", token: randomUUID() };
    const validArchive = { sha256: "a".repeat(64), byteLength: 8192, files: 8 };
    expect(await store.stage(null as never, validArchive)).toBeNull();
    expect(await store.stage({ ...claim, workerId: null } as never, validArchive)).toBeNull();
    expect(await store.stage(claim, { ...validArchive, byteLength: "8192" } as never)).toBeNull();
    expect(await store.readForRequester(null as never)).toBeNull();
    expect(await store.auditVerifiedReadForRequester(requester, null as never)).toBeNull();
    expect(await store.previewRetention(null as never)).toBeNull();
    expect(await store.lockCleanupCandidate(null as never)).toBeNull();
    expect(await store.revokeForRequester(null as never)).toBe(false);
    await expect(store.markPhysicallyCleaned(null as never, "deleted")).rejects.toThrow(
      "Invalid archive cleanup scope",
    );
    expect(query).not.toHaveBeenCalled();
  });
});
