import type { WorkspaceMemberRecord } from "@boardreadyops/db";
import type { Metadata } from "next";
import Link from "next/link";
import {
  AddWorkspaceMemberForm,
  RemoveWorkspaceMemberButton,
} from "../../../components/settings/workspace-member-forms.js";
import { Button } from "../../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../../components/ui/data-table.js";
import { Alert, EmptyState, Panel, StatusBadge } from "../../../components/ui.js";
import { WorkspaceSwitcher } from "../../../components/workspace-switcher.js";
import { viewerAuthorization } from "../../../lib/viewer-authorization.js";
import { canManageMembers, isLastOwner, loadWorkspaceMembers } from "../../../lib/workspace-members.js";
import { removeWorkspaceMemberAction, upsertWorkspaceMemberAction } from "./actions.js";

export const metadata: Metadata = {
  title: "Workspace Members",
  description: "Who can reach this workspace's projects, revisions and delivery links.",
};

// Scoped to the viewer's memberships, so it can never be prerendered.
export const dynamic = "force-dynamic";

export type WorkspaceSettingsPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const roleTone: Record<string, string> = {
  owner: "success",
  admin: "info",
  member: "neutral",
  viewer: "neutral",
};

const roleMeans: Record<string, string> = {
  owner: "Full control, including ownership and deletion",
  admin: "Manages members and everything below",
  member: "Creates projects, revisions and delivery links",
  viewer: "Reads only",
};

export default async function WorkspaceSettingsPage({ searchParams }: Readonly<WorkspaceSettingsPageProps>) {
  const parameters = await searchParams;
  const viewer = await viewerAuthorization();
  const result = await loadWorkspaceMembers(viewer.session, first(parameters.workspace));

  if (result.state !== "ok") return <Unavailable state={result.state} />;

  const manage = canManageMembers(result.selected.role);
  const columns: readonly DataColumn<WorkspaceMemberRecord>[] = [
    {
      id: "user",
      header: "GitHub username",
      rowHeader: true,
      cell: (member) => (
        <span className="flex items-center gap-2">
          <span className="font-mono break-all">{member.userId}</span>
          {member.userId === viewer.session?.login ? (
            <span className="text-meta text-muted-foreground">(you)</span>
          ) : null}
        </span>
      ),
    },
    {
      id: "role",
      header: "Role",
      cell: (member) => (
        <span className="flex flex-col gap-0.5">
          <StatusBadge value={roleTone[member.role] ?? "neutral"} label={member.role} />
          <span className="text-meta text-muted-foreground">{roleMeans[member.role]}</span>
        </span>
      ),
    },
    {
      id: "since",
      header: "Since",
      align: "end",
      cell: (member) => (
        <time dateTime={member.createdAt} className="text-muted-foreground tabular-nums">
          {member.createdAt.slice(0, 10)}
        </time>
      ),
    },
    ...(manage
      ? [
          {
            id: "actions",
            header: "",
            align: "end" as const,
            cell: (member: WorkspaceMemberRecord) =>
              // The last owner's control is hidden because it would always fail. The store is
              // what actually refuses it.
              isLastOwner(result.members, member.userId) ? (
                <span className="text-meta text-muted-foreground">Last owner</span>
              ) : (
                <RemoveWorkspaceMemberButton
                  workspaceId={result.selected.id}
                  userId={member.userId}
                  action={removeWorkspaceMemberAction}
                />
              ),
          },
        ]
      : []),
  ];

  return (
    <>
      {/* No heading of its own: the settings layout owns the page's h1, and a second one is what
          the audit's heading-h1-multiple check exists to catch. */}
      <WorkspaceSwitcher
        workspaces={result.workspaces}
        selectedId={result.selected.id}
        basePath="/settings/workspace"
      />

      <Panel
        title={`${result.selected.name} members`}
        description={`You are ${result.selected.role}. Membership grants access to this workspace\u2019s projects, revisions and delivery links \u2014 separately from a GitHub App installation, which grants access to repository reviews.`}
      >
        <DataTable
          caption={`Members of ${result.selected.name}`}
          columns={columns}
          rows={result.members}
          rowKey={(member) => member.userId}
          empty={
            <EmptyState title="No members recorded">
              <p>Every workspace has at least its creator, so this is unexpected.</p>
            </EmptyState>
          }
        />
      </Panel>

      {manage ? (
        <Panel title="Grant access" description="Re-granting an existing member changes their role.">
          <Alert tone="warning" title="This is a grant, not an invitation">
            There is nothing for the person to accept and no notification is sent. The username is not checked against
            GitHub either — a typo silently grants access to whoever holds that login.
          </Alert>
          <div className="mt-4">
            <AddWorkspaceMemberForm
              workspaceId={result.selected.id}
              canGrantOwner={result.selected.role === "owner"}
              action={upsertWorkspaceMemberAction}
            />
          </div>
        </Panel>
      ) : (
        <Panel title="Grant access">
          <EmptyState title="Only owners and admins can manage members">
            <p>Ask an owner of {result.selected.name} if you need someone added.</p>
          </EmptyState>
        </Panel>
      )}
    </>
  );
}

function Unavailable({ state }: Readonly<{ state: "signed-out" | "not-configured" | "no-workspaces" }>) {
  if (state === "signed-out") {
    return (
      <Panel title="Workspace members">
        <EmptyState title="Sign in to manage workspace access">
          <Button asChild className="mt-3">
            <a href="/api/auth/github/login">Sign in with GitHub</a>
          </Button>
        </EmptyState>
      </Panel>
    );
  }

  if (state === "not-configured") {
    return (
      <Panel title="Workspace members">
        <EmptyState title="Workspaces are not configured">
          <p>This deployment has no control-plane database, so workspaces and their members cannot be stored.</p>
        </EmptyState>
      </Panel>
    );
  }

  return (
    <Panel title="Workspace members">
      <EmptyState title="Create a workspace first">
        <p>Members belong to a workspace, and you are not in one yet.</p>
        <Button asChild className="mt-3">
          <Link href="/projects">Go to Projects</Link>
        </Button>
      </EmptyState>
    </Panel>
  );
}
