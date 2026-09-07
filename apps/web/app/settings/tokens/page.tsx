import type { ApiTokenRecord } from "@boardreadyops/db";
import { TokenCreateForm } from "../../../components/settings/token-create-form.js";
import { TokenRevokeButton } from "../../../components/settings/token-revoke-button.js";
import { Button } from "../../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../../components/ui/data-table.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { listRepositoryTokens, resolveTokenAdminScope, tokenState } from "../../../lib/api-token-admin.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { createTokenAction, revokeTokenAction } from "./actions.js";

export const metadata = {
  title: "API Tokens",
  description: "Repository-scoped bearer tokens for the CLI, the GitHub Action, and automation.",
};

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export type TokensPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function when(value: string | undefined): string {
  if (!value) return "—";
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? "—" : new Date(parsed).toISOString().slice(0, 10);
}

function tokenColumns(repositoryId: string): readonly DataColumn<ApiTokenRecord>[] {
  return [
    {
      id: "name",
      header: "Name",
      rowHeader: true,
      cell: (token) => (
        <>
          {token.name}
          <div className="mt-0.5 font-mono text-meta text-muted-foreground">{token.tokenPrefix}…</div>
        </>
      ),
    },
    { id: "state", header: "State", cell: (token) => <StatusBadge value={tokenState(token)} /> },
    {
      id: "scopes",
      header: "Scopes",
      cell: (token) => (
        <span className="flex flex-wrap gap-1">
          {token.scopes.map((scope) => (
            <code key={scope} className="rounded-sm bg-muted px-1.5 py-0.5 font-mono text-meta">
              {scope}
            </code>
          ))}
        </span>
      ),
    },
    { id: "created", header: "Created", cell: (token) => when(token.createdAt) },
    { id: "expires", header: "Expires", cell: (token) => when(token.expiresAt) },
    { id: "used", header: "Last used", cell: (token) => when(token.lastUsedAt) },
    {
      id: "actions",
      header: "Actions",
      align: "end",
      cell: (token) =>
        tokenState(token) === "active" ? (
          <TokenRevokeButton
            repositoryId={repositoryId}
            tokenId={token.id}
            tokenName={token.name}
            action={revokeTokenAction}
          />
        ) : (
          <span className="text-meta text-muted-foreground">—</span>
        ),
    },
  ];
}

export default async function TokensPage({ searchParams }: Readonly<TokensPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const scope = await resolveTokenAdminScope(viewer.session, first(parameters.repositoryId));

  if (!viewer.session) {
    return (
      <Panel title="API Tokens" description="Repository-scoped bearer tokens for the CLI and automation.">
        <EmptyState title="Sign in to manage tokens">
          <p>Tokens are issued per repository, so BoardReadyOps needs to know which repositories you administer.</p>
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  if (!scope.selected) {
    return (
      <Panel title="API Tokens" description="Repository-scoped bearer tokens for the CLI and automation.">
        <EmptyState title="No repositories to administer yet">
          <p>
            Install the GitHub App on a repository with a hardware project, then come back here to issue a token for it.
          </p>
          <Button asChild className="mt-3">
            <a href="/setup">Go to Setup</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  const tokens = await listRepositoryTokens(scope.selected.id);
  const repositoryId = scope.selected.id;

  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="API Tokens"
        description="Tokens are shown once at creation, stored as SHA-256 digests, and scoped to one repository."
        actions={
          scope.repositories.length > 1 ? (
            <form method="get" className="flex items-center gap-2">
              <label className="text-meta text-muted-foreground" htmlFor="token-repository">
                Repository
              </label>
              <NativeSelect id="token-repository" name="repositoryId" defaultValue={repositoryId} className="w-auto">
                {scope.repositories.map((repository) => (
                  <option key={repository.id} value={repository.id}>
                    {repository.owner}/{repository.name}
                  </option>
                ))}
              </NativeSelect>
              <Button type="submit" variant="outline" size="sm">
                Show
              </Button>
            </form>
          ) : undefined
        }
      >
        <DataTable
          caption={`API tokens for ${scope.selected.owner}/${scope.selected.name}`}
          columns={tokenColumns(repositoryId)}
          rows={tokens}
          rowKey={(token) => token.id}
          empty={
            <EmptyState title="No tokens for this repository yet">
              <p>Create one below to let CI, the CLI, or your own automation report runs into BoardReadyOps.</p>
            </EmptyState>
          }
        />
      </Panel>

      <Panel title="Create a token" description={`Issued for ${scope.selected.owner}/${scope.selected.name}.`}>
        <TokenCreateForm repositoryId={repositoryId} action={createTokenAction} />
        <p className="mt-4 text-meta text-muted-foreground">
          Pass the token via <code className="font-mono">BOARDREADYOPS_TOKEN</code> or stdin — never as a CLI argument,
          and never logged.
        </p>
      </Panel>
    </div>
  );
}
