"use client";

import { useId, useState } from "react";
import type { removeWorkspaceMemberAction, upsertWorkspaceMemberAction } from "../../app/settings/workspace/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

/** Roles an admin may grant. Owner is added for owners by the caller. */
const grantableRoles = [
  { value: "admin", label: "Admin — manage members and everything below" },
  { value: "member", label: "Member — create projects, revisions and delivery links" },
  { value: "viewer", label: "Viewer — read only" },
] as const;

export function AddWorkspaceMemberForm({
  workspaceId,
  canGrantOwner,
  action,
}: Readonly<{
  workspaceId: string;
  canGrantOwner: boolean;
  action: typeof upsertWorkspaceMemberAction;
}>) {
  const loginId = useId();
  const roleId = useId();

  return (
    <ActionForm action={action} className="flex flex-wrap items-end gap-3">
      {({ state, pending }) => (
        <>
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={loginId}>
              GitHub username
            </label>
            <Input
              id={loginId}
              name="userId"
              maxLength={39}
              required
              placeholder="octocat"
              aria-describedby={`${loginId}-hint`}
            />
            <p id={`${loginId}-hint`} className="text-meta text-muted-foreground">
              Access starts the moment they sign in. There is no invitation to accept.
            </p>
            {fieldError(state, "userId") ? (
              <p className="text-meta text-danger">{fieldError(state, "userId")}</p>
            ) : null}
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={roleId}>
              Role
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
            {pending ? "Granting…" : "Grant access"}
          </Button>
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
