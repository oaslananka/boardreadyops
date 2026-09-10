import type { UserSession } from "./user-session.js";
import { type ViewerInstallation, viewerInstallations } from "./viewer-installations.js";

export type SettingsTenantInstallation = Pick<
  ViewerInstallation,
  "id" | "githubInstallationId" | "accountLogin" | "planTier"
>;

export type SettingsTenantScope = {
  readonly installations: readonly SettingsTenantInstallation[];
  readonly selected: SettingsTenantInstallation | undefined;
};

type SettingsTenantDependencies = {
  readonly loadInstallations: (session: UserSession) => Promise<readonly SettingsTenantInstallation[]>;
};

const defaultDependencies: SettingsTenantDependencies = {
  loadInstallations: (session) => viewerInstallations(session, "nexar"),
};

export async function resolveSettingsTenantScope(
  session: UserSession | undefined,
  requestedInstallationId: string | undefined,
  dependencies: SettingsTenantDependencies = defaultDependencies,
): Promise<SettingsTenantScope> {
  if (!session) return { installations: [], selected: undefined };
  const installations = await dependencies.loadInstallations(session);
  const selected =
    requestedInstallationId === undefined
      ? installations[0]
      : installations.find((installation) => installation.id === requestedInstallationId);
  return { installations, selected };
}
