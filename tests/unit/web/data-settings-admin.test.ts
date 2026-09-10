import type { DataLifecycleStore } from "@boardreadyops/db";
import { describe, expect, it, vi } from "vitest";
import {
  createLegalHoldForViewer,
  loadDataSettingsAdmin,
  releaseLegalHoldForViewer,
  requestErasureForViewer,
  requestExportForViewer,
  retentionPolicyForInstallation,
  saveRetentionPolicyForViewer,
} from "../../../apps/web/lib/data-settings-admin.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const session = { login: "octocat", installationIds: [11] } as unknown as UserSession;
const business = { id: "inst-a", githubInstallationId: 11, accountLogin: "acme", planTier: "business" } as const;
const team = { ...business, planTier: "team" } as const;

function deps(selected = business) {
  const store = {
    getRetentionPolicy: vi.fn().mockResolvedValue(null),
    listLegalHolds: vi.fn().mockResolvedValue([]),
    upsertRetentionPolicy: vi.fn().mockImplementation(async (input) => ({ id: "policy-1", ...input })),
    createLegalHold: vi.fn().mockImplementation(async (input) => ({
      id: "hold-1",
      ...input,
      scopeId: input.scopeId ?? null,
      active: true,
      createdAt: "2026-09-10T00:00:00.000Z",
      releasedAt: null,
      releasedBy: null,
    })),
    releaseLegalHold: vi.fn().mockResolvedValue(true),
    createExport: vi.fn().mockImplementation(async (input) => ({ id: "export-1", status: "pending", ...input })),
    createErasure: vi.fn().mockImplementation(async (input) => ({
      id: "erase-1",
      status: "pending",
      dryRun: Boolean(input.dryRun),
      ...input,
    })),
  } as unknown as DataLifecycleStore;
  return {
    store,
    dependencies: {
      resolveTenant: vi.fn().mockResolvedValue({ installations: [selected], selected }),
      openStore: vi.fn().mockResolvedValue({ store, close: vi.fn().mockResolvedValue(undefined) }),
    },
  };
}

describe("retentionPolicyForInstallation", () => {
  it("keeps Free and Team on their plan-defined retention", () => {
    expect(retentionPolicyForInstallation({ ...team, planTier: "free" }, undefined)).toEqual({
      tier: "free",
      retentionDays: 30,
      sourceRetentionHours: 24,
    });
    expect(retentionPolicyForInstallation(team, undefined)).toEqual({
      tier: "team",
      retentionDays: 365,
      sourceRetentionHours: 24,
    });
  });

  it("allows Business/Pilot to choose indefinite or a bounded custom duration", () => {
    expect(retentionPolicyForInstallation(business, undefined)).toEqual({
      tier: "business",
      retentionDays: null,
      sourceRetentionHours: 24,
    });
    expect(retentionPolicyForInstallation({ ...business, planTier: "pilot" }, "730")).toEqual({
      tier: "business",
      retentionDays: 730,
      sourceRetentionHours: 24,
    });
    expect(() => retentionPolicyForInstallation(business, "3651")).toThrow("between 1 and 3650 days");
  });
});

describe("data settings admin", () => {
  it("loads policy and legal holds only for the authorized selected tenant", async () => {
    const { store, dependencies } = deps();
    await expect(loadDataSettingsAdmin(session, "inst-a", dependencies)).resolves.toMatchObject({
      state: "ok",
      selected: business,
      policy: null,
      holds: [],
    });
    expect(store.getRetentionPolicy).toHaveBeenCalledWith("acme");
    expect(store.listLegalHolds).toHaveBeenCalledWith("acme");
  });

  it("saves a retention policy using the selected account login rather than the submitted id", async () => {
    const { store, dependencies } = deps();
    const result = await saveRetentionPolicyForViewer(
      session,
      { installationId: "inst-a", retentionDays: "730" },
      dependencies,
    );
    expect(result.status).toBe("ok");
    expect(store.upsertRetentionPolicy).toHaveBeenCalledWith({
      tenantId: "acme",
      tier: "business",
      retentionDays: 730,
      sourceRetentionHours: 24,
    });
  });

  it("refuses writes when the installation is not authorized", async () => {
    const { store, dependencies } = deps();
    dependencies.resolveTenant.mockResolvedValue({ installations: [business], selected: undefined });
    const result = await saveRetentionPolicyForViewer(
      session,
      { installationId: "other", retentionDays: "30" },
      dependencies,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(store.upsertRetentionPolicy).not.toHaveBeenCalled();
  });

  it("scopes export and erasure requests to the authorized installation tenant", async () => {
    const { store, dependencies } = deps();
    const exported = await requestExportForViewer(
      session,
      { installationId: "inst-a", scope: "organization" },
      dependencies,
    );
    expect(exported.status).toBe("ok");
    expect(store.createExport).toHaveBeenCalledWith({
      tenantId: "acme",
      requestedBy: "octocat",
      scope: "organization",
      scopeId: null,
    });

    const erased = await requestErasureForViewer(
      session,
      { installationId: "inst-a", scope: "organization", confirm: "acme", dryRun: true },
      dependencies,
    );
    expect(erased.status).toBe("ok");
    expect(store.createErasure).toHaveBeenCalledWith({
      tenantId: "acme",
      requestedBy: "octocat",
      scope: "organization",
      scopeId: null,
      dryRun: true,
    });
  });

  it("refuses an organization erasure confirmed with the viewer login instead of the tenant", async () => {
    const { store, dependencies } = deps();
    const result = await requestErasureForViewer(
      session,
      { installationId: "inst-a", scope: "organization", confirm: "octocat", dryRun: false },
      dependencies,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(store.createErasure).not.toHaveBeenCalled();
  });

  it("creates and releases holds against the authorized tenant", async () => {
    const { store, dependencies } = deps();
    const created = await createLegalHoldForViewer(
      session,
      { installationId: "inst-a", scope: "repository", scopeId: "repo-1", reason: "Preserve release evidence" },
      dependencies,
    );
    expect(created.status).toBe("ok");
    expect(store.createLegalHold).toHaveBeenCalledWith({
      tenantId: "acme",
      createdBy: "octocat",
      scope: "repository",
      scopeId: "repo-1",
      reason: "Preserve release evidence",
    });

    const released = await releaseLegalHoldForViewer(
      session,
      { installationId: "inst-a", holdId: "hold-1" },
      dependencies,
    );
    expect(released.status).toBe("ok");
    expect(store.releaseLegalHold).toHaveBeenCalledWith("acme", "hold-1", "octocat");
  });
});
