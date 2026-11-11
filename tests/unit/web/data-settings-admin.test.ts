import { type DataLifecycleStore, LegalHoldAdmissionConflictError } from "@boardreadyops/db";
import { describe, expect, it, vi } from "vitest";
import {
  createLegalHoldForViewer,
  loadDataSettingsAdmin,
  releaseLegalHoldForViewer,
  requestErasureForViewer,
  requestExportForViewer,
  retentionPolicyForInstallation,
  saveRepositoryRetentionPolicyForViewer,
  saveRetentionPolicyForViewer,
} from "../../../apps/web/lib/data-settings-admin.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const session = { userId: 42, login: "octocat", installationIds: [11] } as unknown as UserSession;
const business = { id: "inst-a", githubInstallationId: 11, accountLogin: "acme", planTier: "business" } as const;
const team = { ...business, planTier: "team" } as const;

function deps(selected = business) {
  const store = {
    getRetentionPolicy: vi.fn().mockResolvedValue(null),
    listRepositoryRetentionPolicies: vi.fn().mockResolvedValue([
      {
        repositoryId: "repo-1",
        owner: "acme",
        name: "controller",
        hasOverride: false,
        retentionDays: null,
      },
    ]),
    upsertRepositoryRetentionPolicy: vi.fn().mockImplementation(async (input) => ({
      repositoryId: input.repositoryId,
      owner: "acme",
      name: "controller",
      hasOverride: true,
      retentionDays: input.retentionDays,
    })),
    clearRepositoryRetentionPolicy: vi.fn().mockResolvedValue(true),
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
    createBoundPendingExport: vi.fn().mockResolvedValue("export-1"),
    listVerifiedHistoricalUserExportReceipts: vi
      .fn()
      .mockResolvedValue([{ exportId: "history-1", status: "pending", createdAt: "2026-11-11T07:00:00.000Z" }]),
    listRecentForRequester: vi
      .fn()
      .mockResolvedValue([{ exportId: "recent-1", status: "pending", createdAt: "2026-11-11T00:00:00.000Z" }]),
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
    expect(store.listVerifiedHistoricalUserExportReceipts).toHaveBeenCalledWith({ verifiedGitHubUserId: 42 });
    expect(store.getRetentionPolicy).toHaveBeenCalledWith("acme");
    expect(store.listLegalHolds).toHaveBeenCalledWith("acme");
  });

  it("loads recent receipts for the original requester and rechecks installation permission after storage IO", async () => {
    const { store, dependencies } = deps();
    const outcome = await loadDataSettingsAdmin(session, "inst-a", dependencies);
    expect(outcome).toMatchObject({ state: "ok", recentExportRequests: [{ exportId: "recent-1" }] });
    expect(
      (store as typeof store & { listRecentForRequester: ReturnType<typeof vi.fn> }).listRecentForRequester,
    ).toHaveBeenCalledWith({ tenantId: "acme", installationId: "inst-a", actorLogin: "octocat" });
    expect(dependencies.resolveTenant).toHaveBeenCalledTimes(2);

    const { dependencies: revokedDependencies } = deps();
    revokedDependencies.resolveTenant.mockResolvedValueOnce({ installations: [business], selected: business });
    revokedDependencies.resolveTenant.mockResolvedValueOnce({ installations: [], selected: undefined });
    expect(await loadDataSettingsAdmin(session, "inst-a", revokedDependencies)).toMatchObject({
      state: "not-authorized",
    });

    // A GitHub App installation can be reassigned under the same database id.
    // Old tenant receipts must not be server-rendered in that case either.
    const { dependencies: reassignedDependencies } = deps();
    reassignedDependencies.resolveTenant.mockResolvedValueOnce({ installations: [business], selected: business });
    reassignedDependencies.resolveTenant.mockResolvedValueOnce({
      installations: [{ ...business, accountLogin: "other-owner" }],
      selected: { ...business, accountLogin: "other-owner" },
    });
    expect(await loadDataSettingsAdmin(session, "inst-a", reassignedDependencies)).toMatchObject({
      state: "not-authorized",
    });
  });

  it("shows personal uninstall recovery status when the signed-in GitHub user has no App installation", async () => {
    const { store, dependencies } = deps();
    dependencies.resolveTenant.mockResolvedValueOnce({ installations: [], selected: undefined });
    const outcome = await loadDataSettingsAdmin(session, undefined, dependencies);
    expect(outcome).toMatchObject({
      state: "no-installations",
      historyUnavailable: false,
      historicalUserRequests: [{ exportId: "history-1", status: "pending" }],
    });
    expect(store.listVerifiedHistoricalUserExportReceipts).toHaveBeenCalledWith({ verifiedGitHubUserId: 42 });
    expect(dependencies.openStore).toHaveBeenCalledTimes(1);
  });

  it("never lists historical requests for an unauthenticated viewer or an invalid GitHub identity", async () => {
    const { store, dependencies } = deps();
    expect(await loadDataSettingsAdmin(undefined, undefined, dependencies)).toMatchObject({ state: "signed-out" });
    expect(dependencies.openStore).not.toHaveBeenCalled();
    dependencies.resolveTenant.mockResolvedValue({ installations: [], selected: undefined });
    expect(await loadDataSettingsAdmin({ ...session, userId: -10 }, undefined, dependencies)).toMatchObject({
      state: "no-installations",
      historicalUserRequests: [],
    });
    expect(store.listVerifiedHistoricalUserExportReceipts).not.toHaveBeenCalled();
  });

  it("reports unavailable history without disclosing backend errors", async () => {
    const { dependencies } = deps();
    dependencies.resolveTenant.mockResolvedValue({ installations: [], selected: undefined });
    dependencies.openStore.mockRejectedValueOnce(new Error("secret database URL and customer id"));
    const outcome = await loadDataSettingsAdmin(session, undefined, dependencies);
    expect(outcome).toMatchObject({
      state: "no-installations",
      historicalUserRequests: [],
      historyUnavailable: true,
    });
    expect(JSON.stringify(outcome)).not.toContain("secret database");
  });

  it("preserves current installation policy if historical status storage temporarily fails", async () => {
    const { store, dependencies } = deps();
    vi.mocked(store.listVerifiedHistoricalUserExportReceipts).mockRejectedValueOnce(
      new Error("private database detail"),
    );
    const state = await loadDataSettingsAdmin(session, "inst-a", dependencies);
    expect(state).toMatchObject({
      state: "ok",
      selected: business,
      historicalUserRequests: [],
      historyUnavailable: true,
    });
    expect(JSON.stringify(state)).not.toContain("private database detail");
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
      installationId: "inst-a",
      actorId: "42",
      actorLogin: "octocat",
      tier: "business",
      retentionDays: 730,
      sourceRetentionHours: 24,
    });
  });

  it("saves and clears repository retention overrides only inside the selected installation", async () => {
    const { store, dependencies } = deps();

    const saved = await saveRepositoryRetentionPolicyForViewer(
      session,
      {
        installationId: "inst-a",
        repositoryId: "repo-1",
        mode: "custom",
        retentionDays: "90",
      },
      dependencies,
    );
    expect(saved).toMatchObject({
      status: "ok",
      data: { repositoryId: "repo-1", retentionDays: 90, inherited: false },
    });
    expect(store.upsertRepositoryRetentionPolicy).toHaveBeenCalledWith({
      installationId: "inst-a",
      repositoryId: "repo-1",
      retentionDays: 90,
      actorId: "42",
      actorLogin: "octocat",
    });

    const inherited = await saveRepositoryRetentionPolicyForViewer(
      session,
      {
        installationId: "inst-a",
        repositoryId: "repo-1",
        mode: "inherit",
      },
      dependencies,
    );
    expect(inherited).toMatchObject({ status: "ok", data: { repositoryId: "repo-1", inherited: true } });
    expect(store.clearRepositoryRetentionPolicy).toHaveBeenCalledWith({
      installationId: "inst-a",
      repositoryId: "repo-1",
      actorId: "42",
      actorLogin: "octocat",
    });
  });

  it("rejects repository retention writes outside the selected installation and on fixed-retention plans", async () => {
    const { store, dependencies } = deps();

    const outside = await saveRepositoryRetentionPolicyForViewer(
      session,
      {
        installationId: "inst-a",
        repositoryId: "repo-other",
        mode: "indefinite",
      },
      dependencies,
    );
    expect(outside).toMatchObject({ status: "error" });
    expect(store.upsertRepositoryRetentionPolicy).not.toHaveBeenCalled();

    dependencies.resolveTenant.mockResolvedValue({
      installations: [{ ...business, planTier: "team" }],
      selected: { ...business, planTier: "team" },
    });
    const fixed = await saveRepositoryRetentionPolicyForViewer(
      session,
      {
        installationId: "inst-a",
        repositoryId: "repo-1",
        mode: "custom",
        retentionDays: "30",
      },
      dependencies,
    );
    expect(fixed).toMatchObject({ status: "error" });
    expect(store.upsertRepositoryRetentionPolicy).not.toHaveBeenCalled();
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
    expect(exported).toMatchObject({
      status: "ok",
      data: { exportId: "export-1", status: "pending" },
      message: "Export request recorded; creating a downloadable pack requires operator processing.",
    });
    expect(store.createBoundPendingExport).toHaveBeenCalledWith({
      tenantId: "acme",
      installationId: "inst-a",
      requestedBy: "octocat",
      scope: "organization",
      scopeId: null,
    });
    expect(store.createExport).not.toHaveBeenCalled();

    const erased = await requestErasureForViewer(
      session,
      { installationId: "inst-a", scope: "organization", confirm: "acme", dryRun: true },
      dependencies,
    );
    expect(erased).toMatchObject({
      status: "ok",
      data: { erasureId: "erase-1", dryRun: true },
      message: "Preview recorded. No records were deleted or enumerated; review the requested scope.",
    });
    expect(store.createErasure).toHaveBeenCalledWith({
      tenantId: "acme",
      requestedBy: "octocat",
      scope: "organization",
      scopeId: null,
      dryRun: true,
    });
  });

  it("rejects vanished installation or repository exports without falling back to unbound intake", async () => {
    const { store, dependencies } = deps();
    vi.mocked(store.createBoundPendingExport).mockResolvedValueOnce(null);
    const result = await requestExportForViewer(
      session,
      { installationId: "inst-a", scope: "repository", scopeId: "repo-a" },
      dependencies,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(store.createBoundPendingExport).toHaveBeenCalledWith({
      tenantId: "acme",
      installationId: "inst-a",
      requestedBy: "octocat",
      scope: "repository",
      scopeId: "repo-a",
    });
    expect(store.createExport).not.toHaveBeenCalled();
  });

  it("fails closed on unverified user-scope export intake before opening storage", async () => {
    const { store, dependencies } = deps();
    const result = await requestExportForViewer(
      session,
      { installationId: "inst-a", scope: "user", scopeId: "octocat" },
      dependencies,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(store.createExport).not.toHaveBeenCalled();
    expect(store.createBoundPendingExport).not.toHaveBeenCalled();
    expect(dependencies.openStore).not.toHaveBeenCalled();
  });

  it("does not claim an accepted non-preview erasure request deleted data", async () => {
    const { store, dependencies } = deps();
    const result = await requestErasureForViewer(
      session,
      { installationId: "inst-a", scope: "organization", confirm: "acme", dryRun: false },
      dependencies,
    );
    expect(result).toMatchObject({
      status: "ok",
      data: { erasureId: "erase-1", status: "pending", dryRun: false },
      message:
        "Erasure request recorded; no records have been deleted. Completion requires an authorized operator workflow.",
    });
    expect(store.createErasure).toHaveBeenCalledOnce();
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

  it("does not falsely report that a legal hold exists while irreversible deletion is in flight", async () => {
    const { store, dependencies } = deps();
    vi.mocked(store.createLegalHold).mockRejectedValueOnce(new LegalHoldAdmissionConflictError());
    const result = await createLegalHoldForViewer(
      session,
      { installationId: "inst-a", scope: "organization", reason: "Preserve incident evidence" },
      dependencies,
    );
    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" ? result.error : "").toContain("hold was NOT created");
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
