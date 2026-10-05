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
    ]);
  });

  it("rejects retention values outside the maintenance worker bound", async () => {
    const query = vi.fn();
    const store = new DataLifecycleStore({ query });

    await expect(
      store.upsertRetentionPolicy({
        tenantId: "acme-hardware",
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
      .mockResolvedValueOnce({ rowCount: 1 });
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
      }),
    ).resolves.toMatchObject({ repositoryId: "repo-1", hasOverride: true, retentionDays: null });
    await expect(
      store.clearRepositoryRetentionPolicy({ installationId: "inst-a", repositoryId: "repo-1" }),
    ).resolves.toBe(true);

    expect(query.mock.calls[1]?.[0]).toContain("repositories.installation_id = $2");
    expect(query.mock.calls[2]?.[0]).toContain("repositories.installation_id = $2");
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
