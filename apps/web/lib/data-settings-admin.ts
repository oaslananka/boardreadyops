import type { DataLifecycleStore, LegalHold, RepositoryRetentionPolicy, RetentionPolicy } from "@boardreadyops/db";
import { type ActionResult, fail, ok } from "./action-result.js";
import {
  resolveSettingsTenantScope,
  type SettingsTenantInstallation,
  type SettingsTenantScope,
} from "./settings-tenant.js";
import type { UserSession } from "./user-session.js";

export type DataSettingsAdminState =
  | { state: "signed-out" }
  | { state: "no-installations"; installations: readonly SettingsTenantInstallation[] }
  | { state: "not-authorized"; installations: readonly SettingsTenantInstallation[] }
  | {
      state: "not-configured";
      installations: readonly SettingsTenantInstallation[];
      selected: SettingsTenantInstallation;
    }
  | {
      state: "ok";
      installations: readonly SettingsTenantInstallation[];
      selected: SettingsTenantInstallation;
      policy: RetentionPolicy | null;
      repositoryPolicies: readonly RepositoryRetentionPolicy[];
      holds: readonly LegalHold[];
    };

type DataSettingsStore = Pick<
  DataLifecycleStore,
  | "getRetentionPolicy"
  | "listRepositoryRetentionPolicies"
  | "upsertRepositoryRetentionPolicy"
  | "clearRepositoryRetentionPolicy"
  | "listLegalHolds"
  | "upsertRetentionPolicy"
  | "createLegalHold"
  | "releaseLegalHold"
  | "createExport"
  | "createErasure"
>;

type OpenedStore = { readonly store: DataSettingsStore; readonly close: () => Promise<void> };

export type DataSettingsAdminDependencies = {
  readonly resolveTenant: (
    session: UserSession | undefined,
    requestedInstallationId: string | undefined,
  ) => Promise<SettingsTenantScope>;
  readonly openStore: () => Promise<OpenedStore | undefined>;
};

async function openDefaultStore(): Promise<OpenedStore | undefined> {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) return undefined;
  const [{ DataLifecycleStore }, { createPgQueryExecutor }] = await Promise.all([
    import("@boardreadyops/db"),
    import("@boardreadyops/db/pg-executor"),
  ]);
  const executor = createPgQueryExecutor({ connectionString, max: 1 });
  return { store: new DataLifecycleStore(executor), close: () => executor.close() };
}

const defaultDependencies: DataSettingsAdminDependencies = {
  resolveTenant: resolveSettingsTenantScope,
  openStore: openDefaultStore,
};

export function customizableRetention(planTier: string): boolean {
  return ["business", "pilot", "enterprise"].includes(planTier.trim().toLowerCase());
}

function boundedRetentionDays(value: string | undefined): number {
  const normalized = value?.trim();
  if (!normalized || !/^\d+$/u.test(normalized)) {
    throw new Error("Retention must be a whole number between 1 and 3650 days.");
  }
  const retentionDays = Number(normalized);
  if (!Number.isSafeInteger(retentionDays) || retentionDays < 1 || retentionDays > 3_650) {
    throw new Error("Retention must be between 1 and 3650 days.");
  }
  return retentionDays;
}

function planRetentionTier(planTier: string): "free" | "team" | "business" {
  switch (planTier.trim().toLowerCase()) {
    case "team":
      return "team";
    case "business":
    case "pilot":
    case "enterprise":
      return "business";
    default:
      return "free";
  }
}

export function retentionPolicyForInstallation(
  installation: SettingsTenantInstallation,
  requestedRetentionDays: string | undefined,
): Pick<RetentionPolicy, "tier" | "retentionDays" | "sourceRetentionHours"> {
  const tier = planRetentionTier(installation.planTier);
  if (tier === "free") return { tier, retentionDays: 30, sourceRetentionHours: 24 };
  if (tier === "team") return { tier, retentionDays: 365, sourceRetentionHours: 24 };
  const value = requestedRetentionDays?.trim();
  if (!value) return { tier, retentionDays: null, sourceRetentionHours: 24 };
  return { tier, retentionDays: boundedRetentionDays(value), sourceRetentionHours: 24 };
}

async function authorizedTenant(
  session: UserSession,
  installationId: string,
  dependencies: DataSettingsAdminDependencies,
): Promise<SettingsTenantInstallation | undefined> {
  return (await dependencies.resolveTenant(session, installationId)).selected;
}

export async function loadDataSettingsAdmin(
  session: UserSession | undefined,
  requestedInstallationId: string | undefined,
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<DataSettingsAdminState> {
  if (!session) return { state: "signed-out" };
  const scope = await dependencies.resolveTenant(session, requestedInstallationId);
  if (scope.installations.length === 0) return { state: "no-installations", installations: scope.installations };
  if (!scope.selected) return { state: "not-authorized", installations: scope.installations };
  const opened = await dependencies.openStore();
  if (!opened) return { state: "not-configured", installations: scope.installations, selected: scope.selected };
  try {
    const [policy, repositoryPolicies, holds] = await Promise.all([
      opened.store.getRetentionPolicy(scope.selected.accountLogin),
      opened.store.listRepositoryRetentionPolicies(scope.selected.id),
      opened.store.listLegalHolds(scope.selected.accountLogin),
    ]);
    return {
      state: "ok",
      installations: scope.installations,
      selected: scope.selected,
      policy,
      repositoryPolicies,
      holds,
    };
  } finally {
    await opened.close();
  }
}

export async function saveRetentionPolicyForViewer(
  session: UserSession,
  input: { installationId: string; retentionDays?: string | undefined },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ retentionDays: number | null }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  let policy: Pick<RetentionPolicy, "tier" | "retentionDays" | "sourceRetentionHours">;
  try {
    policy = retentionPolicyForInstallation(selected, input.retentionDays);
  } catch (error) {
    return fail(error instanceof Error ? error.message : "Retention policy is invalid.");
  }
  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const saved = await opened.store.upsertRetentionPolicy({
      tenantId: selected.accountLogin,
      installationId: selected.id,
      actorId: String(session.userId),
      actorLogin: session.login,
      ...policy,
    });
    return ok({ retentionDays: saved.retentionDays }, "Retention policy saved.");
  } finally {
    await opened.close();
  }
}

export async function saveRepositoryRetentionPolicyForViewer(
  session: UserSession,
  input: {
    installationId: string;
    repositoryId: string;
    mode: "inherit" | "indefinite" | "custom";
    retentionDays?: string | undefined;
  },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ repositoryId: string; retentionDays: number | null; inherited: boolean }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  if (!customizableRetention(selected.planTier)) {
    return fail("Repository retention overrides require a Business, Pilot, or Enterprise plan.");
  }

  let retentionDays: number | null = null;
  if (input.mode === "custom") {
    try {
      retentionDays = boundedRetentionDays(input.retentionDays);
    } catch (error) {
      return fail(error instanceof Error ? error.message : "Retention policy is invalid.");
    }
  }

  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const repositories = await opened.store.listRepositoryRetentionPolicies(selected.id);
    if (!repositories.some((repository) => repository.repositoryId === input.repositoryId)) {
      return fail("That repository is not available under the selected installation.");
    }

    if (input.mode === "inherit") {
      await opened.store.clearRepositoryRetentionPolicy({
        installationId: selected.id,
        repositoryId: input.repositoryId,
        actorId: String(session.userId),
        actorLogin: session.login,
      });
      return ok(
        { repositoryId: input.repositoryId, retentionDays: null, inherited: true },
        "Repository now inherits organization retention.",
      );
    }

    const saved = await opened.store.upsertRepositoryRetentionPolicy({
      installationId: selected.id,
      repositoryId: input.repositoryId,
      retentionDays,
      actorId: String(session.userId),
      actorLogin: session.login,
    });
    if (!saved) return fail("That repository is no longer available under the selected installation.");
    return ok(
      { repositoryId: saved.repositoryId, retentionDays: saved.retentionDays, inherited: false },
      saved.retentionDays === null
        ? "Repository artifacts will be retained indefinitely."
        : `Repository artifact retention set to ${saved.retentionDays} days.`,
    );
  } finally {
    await opened.close();
  }
}

export async function requestExportForViewer(
  session: UserSession,
  input: {
    installationId: string;
    scope: "organization" | "repository" | "user";
    scopeId?: string | undefined;
  },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ exportId: string; status: string }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  const scopeId = input.scope === "organization" ? undefined : input.scopeId?.trim();
  if (input.scope !== "organization" && !scopeId) return fail("Repository and user exports require a scope id.");
  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const record = await opened.store.createExport({
      tenantId: selected.accountLogin,
      requestedBy: session.login,
      scope: input.scope,
      scopeId: scopeId ?? null,
    });
    return ok(
      { exportId: record.id, status: record.status },
      "Export requested. It is generated asynchronously and the download link is time-limited.",
    );
  } finally {
    await opened.close();
  }
}

export async function requestErasureForViewer(
  session: UserSession,
  input: {
    installationId: string;
    scope: "organization" | "repository" | "user";
    scopeId?: string | undefined;
    confirm: string;
    dryRun: boolean;
  },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ erasureId: string; status: string; dryRun: boolean }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  const scopeId = input.scope === "organization" ? undefined : input.scopeId?.trim();
  if (input.scope !== "organization" && !scopeId) return fail("Repository and user erasures require a scope id.");
  const expected = scopeId ?? selected.accountLogin;
  if (input.confirm.trim() !== expected) {
    return fail(`Type "${expected}" exactly to confirm.`, { confirm: ["Confirmation does not match."] });
  }
  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const record = await opened.store.createErasure({
      tenantId: selected.accountLogin,
      requestedBy: session.login,
      scope: input.scope,
      scopeId: scopeId ?? null,
      dryRun: input.dryRun,
    });
    if (record.status === "blocked_by_hold") {
      return fail("An active legal hold covers this scope, so nothing was erased.");
    }
    return ok(
      { erasureId: record.id, status: record.status, dryRun: record.dryRun },
      record.dryRun
        ? "Preview recorded. Nothing was deleted — review the scope before running it for real."
        : "Erasure requested. It is processed asynchronously and cannot be undone.",
    );
  } finally {
    await opened.close();
  }
}

export async function createLegalHoldForViewer(
  session: UserSession,
  input: {
    installationId: string;
    scope: "organization" | "repository" | "user";
    scopeId?: string | undefined;
    reason: string;
  },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ holdId: string }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  const reason = input.reason.trim();
  if (reason.length < 10) return fail("Legal hold reason must be at least 10 characters.");
  const scopeId = input.scope === "organization" ? undefined : input.scopeId?.trim();
  if (input.scope !== "organization" && !scopeId) return fail("Repository and user holds require a scope id.");
  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const hold = await opened.store.createLegalHold({
      tenantId: selected.accountLogin,
      createdBy: session.login,
      reason,
      scope: input.scope,
      scopeId: scopeId ?? null,
    });
    return ok({ holdId: hold.id }, "Legal hold created.");
  } finally {
    await opened.close();
  }
}

export async function releaseLegalHoldForViewer(
  session: UserSession,
  input: { installationId: string; holdId: string },
  dependencies: DataSettingsAdminDependencies = defaultDependencies,
): Promise<ActionResult<{ released: true }>> {
  const selected = await authorizedTenant(session, input.installationId, dependencies);
  if (!selected) return fail("You do not have access to that installation.");
  const opened = await dependencies.openStore();
  if (!opened) return fail("This deployment has no database configured.");
  try {
    const released = await opened.store.releaseLegalHold(selected.accountLogin, input.holdId, session.login);
    if (!released) return fail("That legal hold is already released or does not exist.");
    return ok({ released: true }, "Legal hold released.");
  } finally {
    await opened.close();
  }
}
