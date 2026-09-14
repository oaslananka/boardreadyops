import {
  type GitHubAppPermissionDeclaration,
  githubAppPermissionProfile,
} from "@boardreadyops/cloud-core/github-capabilities";
import { type DataColumn, DataTable } from "./ui/data-table.js";
import { Alert, Panel, StatusBadge } from "./ui.js";

/**
 * The GitHub App permission profile, rendered from the declaration in `@boardreadyops/cloud-core`.
 *
 * Every surface that talks about permissions renders this component rather than its own list.
 * The `/setup` page previously hard-coded a table claiming `Contents: none` while the setup API
 * response and `GitHubMutationService` were both built for `contents: write`, so the page
 * promised a least-privilege profile under which its own one-click setup could not work.
 *
 * `granted` is the live `permissions` object from the installation, when a caller has one. With
 * it the table reports what this installation actually allows; without it the table is the
 * declared profile alone, which is the honest answer for a signed-out visitor.
 */

export type AppPermissionProfileProps = {
  /** Live installation grants, keyed as GitHub returns them. Omit for the declared profile only. */
  granted?: Readonly<Record<string, string | undefined>> | undefined;
  /** Declared permissions this installation has not granted at the declared level. */
  missing?: readonly GitHubAppPermissionDeclaration[] | undefined;
  /** Where a maintainer reviews or updates the grant. Rendered as the remedy link. */
  manageUrl?: string | undefined;
};

const levelLabel: Record<string, string> = { read: "Read", write: "Read and write" };

/**
 * Plain text rather than a badge on purpose: ADR-0017 reserves saturated status colour for
 * finding severity and approval state, and "this permission is optional" is neither.
 */
function requirementCell(entry: GitHubAppPermissionDeclaration) {
  return entry.requirement === "core" ? (
    <span className="font-medium text-foreground">Required</span>
  ) : (
    <span className="text-muted-foreground">Enables a capability</span>
  );
}

function columns(
  missingKeys: ReadonlySet<string>,
  showState: boolean,
): readonly DataColumn<GitHubAppPermissionDeclaration>[] {
  const base: DataColumn<GitHubAppPermissionDeclaration>[] = [
    {
      id: "permission",
      header: "Permission",
      rowHeader: true,
      cell: (entry) => (
        <span className="flex flex-col gap-0.5">
          <span className="font-medium text-foreground">{entry.label}</span>
          <span className="text-meta text-muted-foreground">{levelLabel[entry.level] ?? entry.level}</span>
        </span>
      ),
    },
    { id: "requirement", header: "Requirement", cell: requirementCell },
    {
      id: "purpose",
      header: "What it is used for",
      cell: (entry) => <span className="break-words text-muted-foreground">{entry.purpose}</span>,
    },
  ];

  if (!showState) return base;

  return [
    ...base,
    {
      id: "state",
      header: "This installation",
      cell: (entry) =>
        missingKeys.has(entry.key) ? (
          <span className="flex flex-col gap-0.5">
            <StatusBadge value="missing" label="Not granted" />
            <span className="text-meta text-muted-foreground">{entry.degradation}</span>
          </span>
        ) : (
          <StatusBadge value="ready" label="Granted" />
        ),
    },
  ];
}

export function AppPermissionProfile({ granted, missing, manageUrl }: Readonly<AppPermissionProfileProps>) {
  const showState = granted !== undefined;
  const missingList = missing ?? [];
  const missingKeys = new Set(missingList.map((entry) => entry.key));
  const missingCore = missingList.filter((entry) => entry.requirement === "core");

  return (
    <Panel
      id="permissions"
      title="GitHub App permissions"
      description="Repository-scoped only. No organization or user-account permission is requested."
    >
      {showState && missingList.length > 0 ? (
        <div className="mb-4">
          <Alert
            title={
              missingCore.length > 0
                ? "This installation is missing a required permission"
                : "Some capabilities are turned off for this installation"
            }
            tone={missingCore.length > 0 ? "warning" : "info"}
          >
            <ul className="flex list-disc flex-col gap-1 pl-5">
              {missingList.map((entry) => (
                <li key={entry.key}>
                  <strong>
                    {entry.label} ({levelLabel[entry.level] ?? entry.level})
                  </strong>{" "}
                  — {entry.degradation}
                </li>
              ))}
            </ul>
            {manageUrl ? (
              <p>
                <a href={manageUrl} className="text-primary underline underline-offset-2">
                  Review the installation on GitHub
                </a>{" "}
                to grant the missing permissions. GitHub asks an installation owner to approve any added permission.
              </p>
            ) : null}
          </Alert>
        </div>
      ) : null}

      {showState && missingList.length === 0 ? (
        <div className="mb-4">
          <Alert title="Every declared permission is granted" tone="success">
            <p>One-click setup, waiver, and remediation pull requests are available for this installation.</p>
          </Alert>
        </div>
      ) : null}

      <DataTable
        caption="Declared GitHub App permissions, their purpose, and what is lost without each"
        columns={columns(missingKeys, showState)}
        rows={githubAppPermissionProfile}
        rowKey={(entry) => entry.key}
        empty={null}
      />

      <p className="mt-3 text-meta text-muted-foreground">
        Repository writes are confined to <code>boardreadyops.yml</code>,{" "}
        <code>.github/workflows/readiness-runner.yml</code>, and <code>.boardreadyops/**</code>, always on a new branch
        opened as a pull request. BoardReadyOps never commits to a default branch and never bypasses branch protection
        or required reviews.
      </p>
    </Panel>
  );
}
