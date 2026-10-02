"use client";

import Image from "next/image";
import { useId, useState } from "react";
import type {
  removeWorkspaceMemberAction,
  resolveWorkspaceMemberIdentityAction,
  upsertWorkspaceMemberAction,
  WorkspaceMemberIdentityPreview,
} from "../../app/settings/workspace/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

const grantableRoles = [
  { value: "admin", label: "Admin — manage members and everything below" },
  { value: "member", label: "Member — create projects, revisions and delivery links" },
  { value: "viewer", label: "Viewer — read only" },
] as const;

export function AddWorkspaceMemberForm({
  workspaceId,
  canGrantOwner,
  resolveAction,
  action,
}: Readonly<{
  workspaceId: string;
  canGrantOwner: boolean;
  resolveAction: typeof resolveWorkspaceMemberIdentityAction;
  action: typeof upsertWorkspaceMemberAction;
}>) {
  const loginId = useId();
  const roleId = useId();
  const [identity, setIdentity] = useState<WorkspaceMemberIdentityPreview | null>(null);
  const resolvedTitleId = `${loginId}-resolved-title`;
  const hintId = `${loginId}-hint`;

  if (identity) {
    return (
      <div className="flex max-w-2xl flex-col gap-4">
        <section
          aria-labelledby={resolvedTitleId}
          className="flex flex-wrap items-center gap-4 rounded-md border border-border bg-card p-4"
        >
          {identity.avatarUrl ? (
            <Image
              src={identity.avatarUrl}
              alt=""
              width={56}
              height={56}
              className="size-14 rounded-full border border-border"
            />
          ) : null}
          <div className="min-w-0 flex-1">
            <p id={resolvedTitleId} className="font-semibold text-foreground">
              {identity.displayName ?? identity.login}
            </p>
            <p className="text-sm text-muted-foreground">@{identity.login}</p>
            <p className="text-meta font-mono text-muted-foreground">GitHub user ID {identity.githubUserId}</p>
          </div>
          <Button type="button" variant="outline" onClick={() => setIdentity(null)}>
            Choose another
          </Button>
        </section>

        <ActionForm action={action} onSuccess={() => setIdentity(null)} className="flex flex-wrap items-end gap-3">
          {({ state, pending }) => (
            <>
              <input type="hidden" name="workspaceId" value={workspaceId} />
              <input type="hidden" name="userId" value={identity.login} />
              <input type="hidden" name="githubUserId" value={identity.githubUserId} />

              <div className="flex flex-col gap-1.5">
                <label className="text-meta font-medium text-foreground" htmlFor={roleId}>
                  Role for @{identity.login}
                </label>
                <NativeSelect id={roleId} name="role" defaultValue="member">
                  {canGrantOwner ? <option value="owner">Owner — full control, including ownership</option> : null}
                  {grantableRoles.map((role) => (
                    <option key={role.value} value={role.value}>
                      {role.label}
                    </option>
                  ))}
                </NativeSelect>
              </div>

              <Button type="submit" disabled={pending}>
                {pending ? "Confirming…" : "Confirm grant"}
              </Button>
              {state.status === "error" ? <p className="text-sm text-danger">{state.error}</p> : null}
            </>
          )}
        </ActionForm>
      </div>
    );
  }

  return (
    <ActionForm action={resolveAction} onSuccess={setIdentity} className="flex flex-wrap items-end gap-3">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={loginId}>
              GitHub username
            </label>
            <Input id={loginId} name="userId" maxLength={39} required placeholder="octocat" aria-describedby={hintId} />
            <p id={hintId} className="text-meta text-muted-foreground">
              We verify the GitHub account first. Access is not granted until you review the identity and confirm.
            </p>
            {fieldError(state, "userId") ? (
              <p className="text-meta text-danger">{fieldError(state, "userId")}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Checking GitHub…" : "Find GitHub user"}
          </Button>
          {state.status === "error" ? <p className="text-sm text-danger">{state.error}</p> : null}
        </>
      )}
    </ActionForm>
  );
}

export function RemoveWorkspaceMemberButton({
  workspaceId,
  userId,
  action,
}: Readonly<{ workspaceId: string; userId: string; action: typeof removeWorkspaceMemberAction }>) {
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirming(true)}>
        Remove
      </Button>
      {confirming ? (
        <Dialog titleId={titleId} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Remove {userId}?
            </h2>
            <p className="text-sm text-muted-foreground">
              They lose access to this workspace’s projects, revisions and delivery links the next time they load a
              page. Nothing tells them, and you can grant it back at any time.
            </p>
            <ActionForm action={action} onSuccess={() => setConfirming(false)}>
              {({ pending }) => (
                <div className="modal-footer flex justify-end gap-2">
                  <input type="hidden" name="workspaceId" value={workspaceId} />
                  <input type="hidden" name="userId" value={userId} />
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" className="button-delete" disabled={pending}>
                    {pending ? "Removing…" : "Remove access"}
                  </Button>
                </div>
              )}
            </ActionForm>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
