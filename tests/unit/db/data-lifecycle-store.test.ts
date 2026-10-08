import { describe, expect, it, vi } from "vitest";
import { DataLifecycleStore } from "../../../packages/db/src/data-lifecycle-store.js";

describe("data lifecycle administration", () => {
  it("upserts a bounded tenant retention policy and returns the persisted row", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "rp_acme",
          tenant_id: "acme-hardware",
          tier: "business",
          retention_days: 730,
          source_retention_hours: 24,
        },
      ],
    });
    const store = new DataLifecycleStore({ query });

    await expect(
      store.upsertRetentionPolicy({
        tenantId: "acme-hardware",
        installationId: "inst-a",
        actorId: "42",
        actorLogin: "octocat",
        tier: "business",
        retentionDays: 730,
        sourceRetentionHours: 24,
      }),
    ).resolves.toEqual({
      id: "rp_acme",
      tenantId: "acme-hardware",
      tier: "business",
      retentionDays: 730,
      sourceRetentionHours: 24,
    });

    expect(query).toHaveBeenCalledWith(expect.stringMatching(/on conflict \(tenant_id\) do update/iu), [
      expect.any(String),
      "acme-hardware",
      "business",
      730,
      24,
      "inst-a",
      "42",
      "octocat",
    ]);
    const tenantSql = String(query.mock.calls[0]?.[0]);
    expect(tenantSql).toContain("lower(installations.account_login) = lower($2)");
    expect(tenantSql).toContain("'retention.policy.updated'");
    expect(tenantSql).toContain("INSERT INTO audit_events");
  });

  it("rejects retention values outside the maintenance worker bound", async () => {
    const query = vi.fn();
    const store = new DataLifecycleStore({ query });

    await expect(
      store.upsertRetentionPolicy({
        tenantId: "acme-hardware",
        installationId: "inst-a",
        actorId: "42",
        actorLogin: "octocat",
        tier: "business",
        retentionDays: 3651,
        sourceRetentionHours: 24,
      }),
    ).rejects.toThrow("retentionDays must be null or an integer between 1 and 3650");
    expect(query).not.toHaveBeenCalled();
  });

  it("lists, upserts, and clears repository retention policies within one installation", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            repository_id: "repo-1",
            owner: "acme",
            name: "controller",
            has_override: true,
            retention_days: 90,
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            repository_id: "repo-1",
            owner: "acme",
            name: "controller",
            retention_days: null,
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ repository_id: "repo-1" }] });
    const store = new DataLifecycleStore({ query });

    await expect(store.listRepositoryRetentionPolicies("inst-a")).resolves.toEqual([
      {
        repositoryId: "repo-1",
        owner: "acme",
        name: "controller",
        hasOverride: true,
        retentionDays: 90,
      },
    ]);
    await expect(
      store.upsertRepositoryRetentionPolicy({
        installationId: "inst-a",
        repositoryId: "repo-1",
        retentionDays: null,
        actorId: "42",
        actorLogin: "octocat",
      }),
    ).resolves.toMatchObject({ repositoryId: "repo-1", hasOverride: true, retentionDays: null });
    await expect(
      store.clearRepositoryRetentionPolicy({
        installationId: "inst-a",
        repositoryId: "repo-1",
        actorId: "42",
        actorLogin: "octocat",
      }),
    ).resolves.toBe(true);

    const upsertSql = String(query.mock.calls[1]?.[0]);
    const clearSql = String(query.mock.calls[2]?.[0]);
    expect(upsertSql).toContain("repositories.installation_id = $2");
    expect(upsertSql).toContain("'retention.repository.override_set'");
    expect(upsertSql).toContain("INSERT INTO audit_events");
    expect(clearSql).toContain("repositories.installation_id = $2");
    expect(clearSql).toContain("'retention.repository.override_cleared'");
    expect(clearSql).toContain("INSERT INTO audit_events");
    expect(query.mock.calls[1]?.[1]).toEqual(["repo-1", "inst-a", null, "42", "octocat"]);
    expect(query.mock.calls[2]?.[1]).toEqual(["repo-1", "inst-a", "42", "octocat"]);
  });

  it("selects legal-hold-aware erasure status inside the atomic insert statement", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "erasure-1",
          tenant_id: "acme-hardware",
          requested_by: "octocat",
          scope: "repository",
          scope_id: "repo-1",
          status: "blocked_by_hold",
          dry_run: false,
          created_at: "2026-10-09T00:00:00.000Z",
        },
      ],
    });
    const store = new DataLifecycleStore({ query });
    const request = await store.createErasure({
      tenantId: "acme-hardware",
      requestedBy: "octocat",
      scope: "repository",
      scopeId: "repo-1",
      dryRun: false,
    });
    expect(request).toMatchObject({ status: "blocked_by_hold", dryRun: false });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, args] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("WITH matching_hold AS (");
    expect(sql).not.toContain("MATERIALIZED");
    expect(sql).toContain("tenant_id=$2");
    expect(sql).toContain("scope='organization'");
    expect(sql).toContain("scope=$4 AND (scope_id=$5 OR scope_id IS NULL)");
    expect(sql).toContain("WHEN EXISTS (SELECT 1 FROM matching_hold) THEN 'blocked_by_hold'");
    expect(sql).toContain("WHEN $6 THEN 'preview'");
    expect(sql).toContain("ELSE 'pending'");
    expect(sql).toContain("INSERT INTO erasure_requests");
    expect(args).toEqual([expect.any(String), "acme-hardware", "octocat", "repository", "repo-1", false]);
  });

  it("keeps preview status and refuses to record a request when the hold-aware insert fails", async () => {
    const query = vi
      .fn()
      .mockResolvedValueOnce({
        rows: [
          {
            id: "preview-1",
            tenant_id: "acme",
            requested_by: "octocat",
            scope: "organization",
            scope_id: null,
            status: "preview",
            dry_run: true,
            created_at: "2026-10-09T00:00:00.000Z",
          },
        ],
      })
      .mockRejectedValueOnce(new Error("database temporarily unavailable"));
    const store = new DataLifecycleStore({ query });
    expect(
      await store.createErasure({
        tenantId: "acme",
        requestedBy: "octocat",
        scope: "organization",
        dryRun: true,
      }),
    ).toMatchObject({ status: "preview", dryRun: true });
    await expect(
      store.createErasure({
        tenantId: "acme",
        requestedBy: "octocat",
        scope: "organization",
        dryRun: false,
      }),
    ).rejects.toThrow("database temporarily unavailable");
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("rejects malformed erasure and hold scopes before querying, including missing scoped identifiers", async () => {
    const query = vi.fn();
    const store = new DataLifecycleStore({ query });
    for (const scope of ["unknown", "", "organization ", "repository "]) {
      await expect(store.createErasure({ tenantId: "acme", requestedBy: "alice", scope })).rejects.toThrow(
        "Invalid lifecycle scope",
      );
      await expect(
        store.createLegalHold({ tenantId: "acme", createdBy: "alice", reason: "Preserve legal evidence", scope }),
      ).rejects.toThrow("Invalid lifecycle scope");
    }
    for (const scope of ["repository", "user"]) {
      for (const scopeId of [null, undefined, "", " ", " padded ", "\trepo"]) {
        const scoped = scopeId === undefined ? {} : { scopeId };
        await expect(store.createErasure({ tenantId: "acme", requestedBy: "alice", scope, ...scoped })).rejects.toThrow(
          "require a canonical scope id",
        );
        await expect(
          store.createLegalHold({
            tenantId: "acme",
            createdBy: "alice",
            reason: "Preserve legal evidence",
            scope,
            ...scoped,
          }),
        ).rejects.toThrow("require a canonical scope id");
        await expect(store.hasActiveHold("acme", scope, scopeId)).rejects.toThrow("require a canonical scope id");
      }
    }
    for (const scopeId of ["", "repository-1", " "]) {
      await expect(
        store.createErasure({ tenantId: "acme", requestedBy: "alice", scope: "organization", scopeId }),
      ).rejects.toThrow("must not have a scope id");
      await expect(store.hasActiveHold("acme", "organization", scopeId)).rejects.toThrow("must not have a scope id");
    }
    expect(query).not.toHaveBeenCalled();
  });

  it("preserves canonical scoped hold queries and organization-wide holds", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [{ hold_id: "h1" }] });
    const store = new DataLifecycleStore({ query });
    await expect(store.hasActiveHold("acme", "repository", "repo-1")).resolves.toBe(true);
    await expect(store.hasActiveHold("acme", "organization")).resolves.toBe(true);
    expect(query).toHaveBeenNthCalledWith(1, expect.stringContaining("scope='organization' OR (scope=$2"), [
      "acme",
      "repository",
      "repo-1",
    ]);
    expect(query).toHaveBeenNthCalledWith(2, expect.stringContaining("tenant_id=$1"), ["acme", "organization", null]);
  });

  it("lists legal holds with release metadata newest first", async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [
        {
          id: "hold-active",
          tenant_id: "acme-hardware",
          created_by: "alice",
          reason: "Preserve records for investigation",
          scope: "organization",
          scope_id: null,
          active: true,
          created_at: "2026-09-10T10:00:00.000Z",
          released_at: null,
          released_by: null,
        },
        {
          id: "hold-released",
          tenant_id: "acme-hardware",
          created_by: "bob",
          reason: "Preserve repository evidence",
          scope: "repository",
          scope_id: "repo-1",
          active: false,
          created_at: "2026-09-09T10:00:00.000Z",
          released_at: "2026-09-10T11:00:00.000Z",
          released_by: "alice",
        },
      ],
    });
    const store = new DataLifecycleStore({ query });

    await expect(store.listLegalHolds("acme-hardware")).resolves.toEqual([
      expect.objectContaining({ id: "hold-active", active: true, releasedAt: null, releasedBy: null }),
      expect.objectContaining({
        id: "hold-released",
        active: false,
        scopeId: "repo-1",
        releasedAt: "2026-09-10T11:00:00.000Z",
        releasedBy: "alice",
      }),
    ]);
    expect(query).toHaveBeenCalledWith(expect.stringMatching(/order by created_at desc/iu), ["acme-hardware"]);
  });
});
