import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { cleanupHistoricalUserPrivatePartial } from "../../../apps/web/lib/data-export-historical-partial-cleanup.js";

const valid = {
  db: { withTransaction: vi.fn() },
  authority: { exportId: randomUUID(), verifiedGitHubUserId: 9235789401 },
  archiveRoot: "/srv/exports/.private-export-archives",
};

type CleanupQuery = "owner" | "advisory" | "blockers" | "prior" | "audit";

function lockedCleanupFixture(privateZipReader = false, injected: Partial<Record<CleanupQuery, unknown>> = {}) {
  const result = (stage: CleanupQuery, value: unknown) => (Object.hasOwn(injected, stage) ? injected[stage] : value);
  const query = vi.fn(async (sql: string, args?: unknown[]) => {
    if (sql.startsWith("LOCK TABLE")) return { rows: [] };
    if (sql.includes("SELECT e.tenant_id"))
      return result("owner", {
        rows: [
          {
            tenant_id: "original-user",
            preflight_id: randomUUID(),
            expected_archive_sha256: "a".repeat(64),
            expected_archive_bytes: "17",
          },
        ],
      });
    if (sql.includes("pg_try_advisory_xact_lock")) return result("advisory", { rows: [{ acquired: true }] });
    if (sql.includes("AS held"))
      return result("blockers", {
        rows: [
          { held: false, erasure: false, reader: false, private_zip_reader: privateZipReader, active_preflight: false },
        ],
      });
    if (sql.includes("SELECT outcome FROM public.historical_user_partial_cleanup_events"))
      return result("prior", { rows: [] });
    if (sql.includes("INSERT INTO public.historical_user_partial_cleanup_events"))
      return result("audit", { rows: [{ outcome: args?.[5] }] });
    throw new Error("Unexpected cleanup SQL fixture");
  });
  const withTransaction = vi.fn(async (run: (tx: { query: typeof query }) => Promise<unknown>) => run({ query }));
  return { db: { withTransaction } as never, query, withTransaction };
}

// These success-path filesystem tests require Linux private-volume semantics.
const linuxIt = it.skipIf(process.platform !== "linux");

describe("manual historical private cleanup input gate", () => {
  it("rejects malformed identities, missing DB and unsafe roots before any IO", async () => {
    const inputs = [
      null,
      { ...valid, db: null },
      { ...valid, db: {} },
      { ...valid, authority: null },
      { ...valid, authority: { ...valid.authority, exportId: "wrong-id" } },
      { ...valid, authority: { ...valid.authority, verifiedGitHubUserId: -1 } },
      { ...valid, authority: { ...valid.authority, verifiedGitHubUserId: Number.NaN } },
      { ...valid, archiveRoot: "relative/.private-export-archives" },
      { ...valid, archiveRoot: "/srv/exports/../.private-export-archives" },
      { ...valid, archiveRoot: "/srv/exports/.private-export-archives/" },
      { ...valid, archiveRoot: "/srv/exports/other" },
    ];
    for (const input of inputs) {
      expect(await cleanupHistoricalUserPrivatePartial(input as never)).toBe("quarantined");
    }
    expect(valid.db.withTransaction).not.toHaveBeenCalled();
  });

  linuxIt("admits only a private, owned canonical root into the DB transaction gate", async () => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-cleanup-input-"));
    const archiveRoot = join(base, ".private-export-archives");
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const withTransaction = vi.fn().mockResolvedValue("quarantined");
      expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: { withTransaction }, archiveRoot })).toBe(
        "quarantined",
      );
      expect(withTransaction).toHaveBeenCalledOnce();
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
  linuxIt("audits a missing private ZIP only after the original-user gate and transaction", async () => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-cleanup-absent-"));
    const archiveRoot = join(base, ".private-export-archives");
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const fixture = lockedCleanupFixture();
      expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: fixture.db, archiveRoot })).toBe("missing");
      expect(fixture.withTransaction).toHaveBeenCalledOnce();
      const audit = fixture.query.mock.calls.find(([sql]) =>
        sql.includes("INSERT INTO public.historical_user_partial_cleanup_events"),
      );
      expect(audit?.[1]).toEqual([
        valid.authority.exportId,
        valid.authority.verifiedGitHubUserId,
        expect.any(String),
        "a".repeat(64),
        17,
        "missing",
      ]);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  linuxIt.each([
    ["owner", { rows: [{ tenant_id: "original-user" }, { tenant_id: "original-user" }] }, "quarantined"],
    ["owner", { rows: [null] }, "quarantined"],
    ["owner", { rows: { length: 1 } }, "quarantined"],
    [
      "owner",
      {
        rows: [
          {
            tenant_id: "original-user",
            preflight_id: randomUUID(),
            expected_archive_sha256: "a".repeat(64),
            expected_archive_bytes: "1e2",
          },
        ],
      },
      "quarantined",
    ],
    ["advisory", { rows: [{ acquired: true }, { acquired: true }] }, "busy"],
    ["advisory", { rows: [{ acquired: true }, null] }, "busy"],
    [
      "blockers",
      {
        rows: [
          { held: false, erasure: false, reader: false, private_zip_reader: false, active_preflight: false },
          { held: false, erasure: false, reader: false, private_zip_reader: false, active_preflight: false },
        ],
      },
      "quarantined",
    ],
    ["blockers", { rows: [null] }, "quarantined"],
    ["prior", { rows: "not-an-array" }, "quarantined"],
    ["prior", { rows: [{ outcome: "missing" }, { outcome: "missing" }] }, "quarantined"],
    ["prior", { rows: [{ outcome: "untrusted" }] }, "quarantined"],
  ] as const)(
    "does not remove an original-user private archive for untrustworthy %s SQL response",
    async (stage, response, expected) => {
      const base = await mkdtemp(join(tmpdir(), "boardreadyops-unsafe-cleanup-"));
      const archiveRoot = join(base, ".private-export-archives");
      const filename = join(archiveRoot, `${valid.authority.exportId}.historical-private-partial-v3.zip`);
      const privateText = "private file data";
      try {
        await mkdir(archiveRoot, { mode: 0o700 });
        await writeFile(filename, privateText, { mode: 0o600 });
        const fixture = lockedCleanupFixture(false, { [stage]: response });
        expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: fixture.db, archiveRoot })).toBe(expected);
        expect(await readFile(filename, "utf8")).toBe(privateText);
        expect(
          fixture.query.mock.calls.some(([sql]) =>
            sql.includes("INSERT INTO public.historical_user_partial_cleanup_events"),
          ),
        ).toBe(false);
      } finally {
        await rm(base, { recursive: true, force: true });
      }
    },
  );

  linuxIt.each([
    { rows: [] },
    { rows: [{ outcome: "wrong" }] },
    { rows: [{ outcome: "missing" }, { outcome: "missing" }] },
  ])("rejects a missing, mismatched or ambiguous cleanup audit acknowledgement", async (audit) => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-audit-ack-"));
    const archiveRoot = join(base, ".private-export-archives");
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const fixture = lockedCleanupFixture(false, { audit });
      expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: fixture.db, archiveRoot })).toBe("quarantined");
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  linuxIt("never revisits a previously committed exact cleanup audit", async () => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-cleanup-audited-"));
    const archiveRoot = join(base, ".private-export-archives");
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      const fixture = lockedCleanupFixture(false, { prior: { rows: [{ outcome: "missing" }] } });
      expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: fixture.db, archiveRoot })).toBe("cleaned");
      expect(
        fixture.query.mock.calls.some(([sql]) =>
          sql.includes("INSERT INTO public.historical_user_partial_cleanup_events"),
        ),
      ).toBe(false);
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });

  linuxIt("never audits or removes an unsafe private file or an outstanding reader reservation", async () => {
    const base = await mkdtemp(join(tmpdir(), "boardreadyops-cleanup-reader-"));
    const archiveRoot = join(base, ".private-export-archives");
    const name = join(archiveRoot, `${valid.authority.exportId}.historical-private-partial-v3.zip`);
    try {
      await mkdir(archiveRoot, { mode: 0o700 });
      await writeFile(name, "private file data", { mode: 0o644 });
      for (const privateZipReader of [false, true]) {
        const fixture = lockedCleanupFixture(privateZipReader);
        expect(await cleanupHistoricalUserPrivatePartial({ ...valid, db: fixture.db, archiveRoot })).toBe(
          "quarantined",
        );
        expect(fixture.withTransaction).toHaveBeenCalledOnce();
        expect(
          fixture.query.mock.calls.some(([sql]) =>
            sql.includes("INSERT INTO public.historical_user_partial_cleanup_events"),
          ),
        ).toBe(false);
        expect(await readFile(name, "utf8")).toBe("private file data");
      }
    } finally {
      await rm(base, { recursive: true, force: true });
    }
  });
});
