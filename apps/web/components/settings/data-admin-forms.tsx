"use client";

import { useId, useState } from "react";
import type {
  createLegalHoldAction,
  releaseLegalHoldAction,
  saveRetentionPolicyAction,
} from "../../app/settings/data/actions.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";
import { Textarea } from "../ui/textarea.js";

export function RetentionPolicyForm({
  installationId,
  currentRetentionDays,
  customizable,
  action,
}: Readonly<{
  installationId: string;
  currentRetentionDays: number | null;
  customizable: boolean;
  action: typeof saveRetentionPolicyAction;
}>) {
  const retentionId = useId();
  if (!customizable) {
    return <p className="text-sm text-muted-foreground">This plan uses its fixed retention window.</p>;
  }
  return (
    <ActionForm action={action} className="mt-4 flex flex-wrap items-end gap-3">
      {({ pending }) => (
        <>
          <input type="hidden" name="installationId" value={installationId} />
          <div className="flex min-w-0 flex-col gap-1.5">
            <label htmlFor={retentionId} className="text-meta font-medium text-foreground">
              Evidence retention days
            </label>
            <Input
              id={retentionId}
              name="retentionDays"
              type="number"
              min={1}
              max={3650}
              step={1}
              defaultValue={currentRetentionDays ?? ""}
              placeholder="Indefinite"
              inputMode="numeric"
            />
            <p className="text-meta text-muted-foreground">Leave blank for indefinite retention. Maximum 3650 days.</p>
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? "Saving…" : "Save retention"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function LegalHoldCreateForm({
  installationId,
  action,
}: Readonly<{ installationId: string; action: typeof createLegalHoldAction }>) {
  const scopeId = useId();
  const targetId = useId();
  const reasonId = useId();
  return (
    <ActionForm action={action} className="mt-4 grid gap-3 md:grid-cols-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="installationId" value={installationId} />
          <div className="flex flex-col gap-1.5">
            <label htmlFor={scopeId} className="text-meta font-medium text-foreground">
              Scope
            </label>
            <NativeSelect id={scopeId} name="scope" defaultValue="organization">
              <option value="organization">Whole organization</option>
              <option value="repository">One repository</option>
              <option value="user">One user</option>
            </NativeSelect>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={targetId} className="text-meta font-medium text-foreground">
              Scope id
            </label>
            <Input id={targetId} name="scopeId" maxLength={256} placeholder="repo id or GitHub login" />
            <p className="text-meta text-muted-foreground">Repository and user holds need an exact id.</p>
          </div>
          <div className="flex flex-col gap-1.5 md:col-span-2">
            <label htmlFor={reasonId} className="text-meta font-medium text-foreground">
              Reason
            </label>
            <Textarea id={reasonId} name="reason" minLength={10} maxLength={500} required rows={3} />
            <p className="text-meta text-muted-foreground">
              Recorded with the hold for auditability; 10–500 characters.
            </p>
          </div>
          <div className="md:col-span-2">
            <Button type="submit" disabled={pending}>
              {pending ? "Creating…" : "Create legal hold"}
            </Button>
          </div>
        </>
      )}
    </ActionForm>
  );
}

export function LegalHoldReleaseButton({
  installationId,
  holdId,
  reason,
  action,
}: Readonly<{
  installationId: string;
  holdId: string;
  reason: string;
  action: typeof releaseLegalHoldAction;
}>) {
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(true)}>
        Release
      </Button>
      {confirming ? (
        <Dialog titleId={titleId} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Release legal hold?
            </h2>
            <p className="text-sm text-muted-foreground">
              “{reason}” will stop blocking retention cleanup and matching erasure requests. The release remains in the
              audit history.
            </p>
            <ActionForm action={action} onSuccess={() => setConfirming(false)}>
              {({ pending }) => (
                <div className="flex justify-end gap-2">
                  <input type="hidden" name="installationId" value={installationId} />
                  <input type="hidden" name="holdId" value={holdId} />
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" disabled={pending}>
                    {pending ? "Releasing…" : "Release hold"}
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
