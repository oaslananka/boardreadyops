"use client";

import type { WorkspaceRevisionRecord } from "@boardreadyops/db";
import { useRouter } from "next/navigation";
import { useId } from "react";
import type {
  authorizeManufacturingShareAction,
  revokeManufacturingShareAction,
} from "../../app/deliveries/actions.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { NativeSelect } from "../ui/native-select.js";

type Props = Readonly<{
  revisions: readonly WorkspaceRevisionRecord[];
  authorizedRevisionIds: readonly string[];
  approveAction: typeof authorizeManufacturingShareAction;
  revokeAction: typeof revokeManufacturingShareAction;
}>;

function label(revision: WorkspaceRevisionRecord): string {
  return `${revision.projectName} · ${revision.revisionLabel} · ${revision.bundleSha256.slice(0, 12)}`;
}

export function ManufacturingShareAuthorizationForm({
  revisions,
  authorizedRevisionIds,
  approveAction,
  revokeAction,
}: Props) {
  const router = useRouter();
  const approveId = useId();
  const revokeId = useId();
  const acknowledgementId = useId();
  const pending = revisions.filter((revision) => !authorizedRevisionIds.includes(revision.id));
  const active = revisions.filter((revision) => authorizedRevisionIds.includes(revision.id));

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <ActionForm action={approveAction} onSuccess={() => router.refresh()} className="flex flex-col gap-3">
        {({ state, pending: submitting }) => (
          <>
            <label className="text-sm font-medium" htmlFor={approveId}>
              Authorize guest sharing
            </label>
            <NativeSelect id={approveId} name="revisionId" required disabled={pending.length === 0}>
              {pending.map((revision) => (
                <option value={revision.id} key={revision.id}>
                  {label(revision)}
                </option>
              ))}
            </NativeSelect>
            <label className="flex items-start gap-2 text-sm text-muted-foreground" htmlFor={acknowledgementId}>
              <input
                id={acknowledgementId}
                type="checkbox"
                name="acknowledgement"
                value="AUTHORIZE_SHARING"
                required
                className="mt-1"
              />
              <span>
                I authorize guest access to this exact stored archive and source revision. I understand this is not an
                engineering signature or an authorization to fabricate.
              </span>
            </label>
            <Button type="submit" disabled={submitting || pending.length === 0}>
              {submitting ? "Authorizing…" : "Permit guest sharing"}
            </Button>
            {pending.length === 0 ? (
              <p className="text-sm text-muted-foreground">No unapproved evidence-backed revisions.</p>
            ) : null}
            {state.status === "error" ? <p className="text-sm text-danger">{state.error}</p> : null}
          </>
        )}
      </ActionForm>

      <ActionForm action={revokeAction} onSuccess={() => router.refresh()} className="flex flex-col gap-3">
        {({ state, pending: submitting }) => (
          <>
            <label className="text-sm font-medium" htmlFor={revokeId}>
              Revoke guest sharing
            </label>
            <NativeSelect id={revokeId} name="revisionId" required disabled={active.length === 0}>
              {active.map((revision) => (
                <option value={revision.id} key={revision.id}>
                  {label(revision)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-sm text-muted-foreground">
              Revocation immediately prevents existing guest tokens from downloading this revision. A revoked
              authorization cannot be silently reactivated.
            </p>
            <Button type="submit" variant="outline" disabled={submitting || active.length === 0}>
              {submitting ? "Revoking…" : "Revoke access"}
            </Button>
            {active.length === 0 ? (
              <p className="text-sm text-muted-foreground">No active sharing authorizations.</p>
            ) : null}
            {state.status === "error" ? <p className="text-sm text-danger">{state.error}</p> : null}
          </>
        )}
      </ActionForm>
    </div>
  );
}
