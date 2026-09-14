import {
  evaluateActionAvailability,
  evaluateAppCapabilities,
  type GitHubAppActionAvailability,
  type GitHubAppCapabilities,
  type GitHubAppPermissionDeclaration,
  missingDeclaredPermissions,
} from "@boardreadyops/cloud-core/github-capabilities";
import { createAppAuth } from "@octokit/auth-app";

/**
 * What one installation actually lets BoardReadyOps do, read from GitHub rather than assumed.
 *
 * Minting an installation access token returns that installation's live `permissions` object, so
 * the grants come back for free on a call the control plane already has to make. Before this
 * existed, `evaluateAppCapabilities` was only ever reached from webhook-driven code paths: no
 * page could tell a viewer which grant was missing, and the one-click setup button was hidden
 * unconditionally rather than explaining itself.
 *
 * Every failure resolves to `undefined` rather than throwing. A page that cannot read grants
 * shows the declared profile and its manual path, which is strictly better than an error screen.
 */

export type InstallationCapabilities = {
  githubInstallationId: number;
  /** Live grants, keyed as GitHub returns them (`pull_requests`, `contents`, …). */
  permissions: Readonly<Record<string, string>>;
  capabilities: GitHubAppCapabilities;
  /** Declared permissions this installation has not granted at the declared level. */
  missing: readonly GitHubAppPermissionDeclaration[];
  actions: readonly GitHubAppActionAvailability[];
  /** Where an installation owner reviews or widens the grant. */
  manageUrl: string;
};

export type InstallationCapabilitiesDependencies = {
  environment: Readonly<Record<string, string | undefined>>;
  /** Returns the live permission object for an installation, or undefined when unreadable. */
  readPermissions(githubInstallationId: number): Promise<Readonly<Record<string, string>> | undefined>;
};

function appCredentials(environment: Readonly<Record<string, string | undefined>>):
  | {
      appId: string;
      privateKey: string;
    }
  | undefined {
  const appId = environment.GITHUB_APP_ID?.trim();
  // The private key is stored with literal \n escapes in most secret managers.
  const privateKey = environment.GITHUB_APP_PRIVATE_KEY?.replaceAll(String.raw`\n`, "\n").trim();
  if (!appId || !privateKey) return undefined;
  return { appId, privateKey };
}

export function createInstallationCapabilitiesDependencies(
  environment: Readonly<Record<string, string | undefined>> = process.env,
): InstallationCapabilitiesDependencies {
  return {
    environment,
    async readPermissions(githubInstallationId: number) {
      const credentials = appCredentials(environment);
      if (!credentials) return undefined;
      try {
        const authenticate = createAppAuth({ ...credentials, installationId: githubInstallationId });
        const authentication = await authenticate({ type: "installation" });
        const permissions = authentication.permissions ?? {};
        const normalized: Record<string, string> = {};
        for (const [key, value] of Object.entries(permissions)) {
          if (typeof value === "string") normalized[key] = value;
        }
        return normalized;
      } catch {
        // A suspended installation, a revoked key, or a GitHub outage all land here. The caller
        // falls back to the declared profile rather than blocking the page on GitHub being up.
        return undefined;
      }
    },
  };
}

/** GitHub's own installation settings page, which is where a grant is widened. */
function installationManageUrl(githubInstallationId: number): string {
  return `https://github.com/settings/installations/${githubInstallationId}`;
}

export async function loadInstallationCapabilities(
  githubInstallationId: number | undefined,
  dependencies: InstallationCapabilitiesDependencies = createInstallationCapabilitiesDependencies(),
): Promise<InstallationCapabilities | undefined> {
  if (githubInstallationId === undefined || !Number.isSafeInteger(githubInstallationId) || githubInstallationId <= 0) {
    return undefined;
  }
  const permissions = await dependencies.readPermissions(githubInstallationId);
  if (!permissions) return undefined;

  return {
    githubInstallationId,
    permissions,
    capabilities: evaluateAppCapabilities(permissions),
    missing: missingDeclaredPermissions(permissions),
    actions: evaluateActionAvailability(permissions),
    manageUrl: installationManageUrl(githubInstallationId),
  };
}
