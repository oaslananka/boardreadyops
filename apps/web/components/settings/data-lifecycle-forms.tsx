"use client";

import { useId, useState } from "react";
import type { requestErasureAction, requestExportAction } from "../../app/settings/data/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { ActionForm } from "../ui/action-form.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { checkboxClassName } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

function ScopeFields({ idPrefix }: Readonly<{ idPrefix: string }>) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-scope`}>
          Scope
        </label>
        <NativeSelect id={`${idPrefix}-scope`} name="scope" defaultValue="organization">
          <option value="organization">Whole organization</option>
          <option value="repository">One repository</option>
          <option value="user">One user</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-scope-id`}>
          Scope id <span className="font-normal text-muted-foreground">(optional for organization)</span>
        </label>
        <Input id={`${idPrefix}-scope-id`} name="scopeId" placeholder="repository id or login" />
      </div>
    </>
  );
}

export function ExportRequestForm({ action }: Readonly<{ action: typeof requestExportAction }>) {
  const idPrefix = useId();
  const [issued, setIssued] = useState<{ exportId: string; status: string } | null>(null);

  return (
    <ActionForm action={action} className="flex flex-col gap-4" onSuccess={setIssued}>
      {({ pending }) => (
        <>
          <ScopeFields idPrefix={idPrefix} />
          <div>
            <Button type="submit" disabled={pending}>
              {pending ? "Requesting…" : "Request export"}
            </Button>
          </div>
          {issued ? (
            <AlertRoot variant="success">
              <AlertTitle>Export {issued.status}</AlertTitle>
              <AlertDescription>
                Reference <code className="font-mono">{issued.exportId}</code>. Download it from{" "}
                <a
                  className="text-primary underline underline-offset-2"
                  href={`/api/v1/data-exports/${issued.exportId}`}
                >
                  the export endpoint
                </a>{" "}
                once it finishes; the link is signed and time-limited.
              </AlertDescription>
            </AlertRoot>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}

/**
 * Erasure asks for the scope to be typed out, and the server checks it too — a confirmation that
 * only the client enforces is not a confirmation.
 */
export function ErasureRequestForm({
  action,
  defaultScopeLabel,
}: Readonly<{ action: typeof requestErasureAction; defaultScopeLabel: string }>) {
  const idPrefix = useId();
  const [outcome, setOutcome] = useState<{ status: string; dryRun: boolean } | null>(null);

  return (
    <ActionForm action={action} className="flex flex-col gap-4" onSuccess={setOutcome}>
      {({ state, pending }) => (
        <>
          <ScopeFields idPrefix={idPrefix} />

          <label className="flex items-start gap-2 text-sm">
            <input type="checkbox" name="dryRun" defaultChecked className={`${checkboxClassName} mt-0.5`} />
            <span>
              <span className="block">Preview what would be deleted</span>
              <span className="block text-meta text-muted-foreground">
                Records the request and reports the scope without removing anything.
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-confirm`}>
              Type <code className="font-mono">{defaultScopeLabel}</code> to confirm
            </label>
            <Input
              id={`${idPrefix}-confirm`}
              name="confirm"
              required
              autoComplete="off"
              aria-invalid={fieldError(state, "confirm") ? true : undefined}
            />
            {fieldError(state, "confirm") ? (
              <p className="text-meta text-danger">{fieldError(state, "confirm")}</p>
            ) : (
              <p className="text-meta text-muted-foreground">
                Use the scope id if you set one above, otherwise your own login.
              </p>
            )}
          </div>

          <div>
            <Button type="submit" variant="destructive" className="button-delete" disabled={pending}>
              {pending ? "Submitting…" : "Submit erasure request"}
            </Button>
          </div>

          {outcome ? (
            <AlertRoot variant={outcome.dryRun ? "info" : "warning"}>
              <AlertTitle>{outcome.dryRun ? "Preview recorded" : `Erasure ${outcome.status}`}</AlertTitle>
              <AlertDescription>
                {outcome.dryRun
                  ? "Nothing was deleted. Uncheck the preview box to run it for real."
                  : "Processing happens asynchronously and cannot be undone."}
              </AlertDescription>
            </AlertRoot>
          ) : null}
        </>
      )}
    </ActionForm>
  );
}
