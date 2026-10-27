/** Typed declaration for the fail-closed, redacted Node.js release preflight. */
export type RemoteMcpReleaseCheck = {
  id: string;
  status: "configured" | "blocked" | "not_checked" | "manual_required";
};

export interface RemoteMcpReleasePreflightReport {
  schemaVersion: 1;
  publicMcpReleaseApproved: false;
  checks: RemoteMcpReleaseCheck[];
}

export function inspectRemoteMcpReleasePrerequisites(
  environment: Readonly<Record<string, string | undefined>>,
  query?: (sql: string, values?: readonly unknown[]) => Promise<unknown>,
): Promise<RemoteMcpReleasePreflightReport>;
