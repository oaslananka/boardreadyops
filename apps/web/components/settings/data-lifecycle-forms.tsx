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

type DataScope = "organization" | "repository" | "user";

type ScopeFieldsProps = {
  idPrefix: string;
  scope?: DataScope;
  scopeId?: string;
  onScopeChange?: (scope: DataScope) => void;
  onScopeIdChange?: (scopeId: string) => void;
};

function ScopeFields({ idPrefix, scope, scopeId, onScopeChange, onScopeIdChange }: Readonly<ScopeFieldsProps>) {
  return (
    <>
      <div className="flex flex-col gap-1.5">
        <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-scope`}>
          Scope
        </label>
        <NativeSelect
          id={`${idPrefix}-scope`}
          name="scope"
          {...(scope === undefined ? { defaultValue: "organization" } : { value: scope })}
          onChange={onScopeChange ? (event) => onScopeChange(event.currentTarget.value as DataScope) : undefined}
        >
          <option value="organization">Whole organization</option>
          <option value="repository">One repository</option>
          <option value="user">One user</option>
        </NativeSelect>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-scope-id`}>
          Scope id <span className="font-normal text-muted-foreground">(optional for organization)</span>
        </label>
        <Input
          id={`${idPrefix}-scope-id`}
          name="scopeId"
          placeholder="repository id or login"
          {...(scopeId === undefined ? {} : { value: scopeId })}
          onChange={onScopeIdChange ? (event) => onScopeIdChange(event.currentTarget.value) : undefined}
        />
      </div>
    </>
  );
}

export function ExportRequestForm({
  installationId,
  action,
}: Readonly<{ installationId: string; action: typeof requestExportAction }>) {
  const idPrefix = useId();
  const [issued, setIssued] = useState<{ exportId: string; status: string } | null>(null);

  return (
    <ActionForm action={action} className="flex flex-col gap-4" onSuccess={setIssued}>
      {({ pending }) => (
        <>
          <input type="hidden" name="installationId" value={installationId} />
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
  installationId,
  action,
  defaultScopeLabel,
}: Readonly<{ installationId: string; action: typeof requestErasureAction; defaultScopeLabel: string }>) {
  const idPrefix = useId();
  const [outcome, setOutcome] = useState<{ status: string; dryRun: boolean } | null>(null);
  const [scope, setScope] = useState<DataScope>("organization");
  const [scopeId, setScopeId] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const normalizedScopeId = scopeId.trim();
  const confirmationTarget = scope === "organization" ? defaultScopeLabel : normalizedScopeId;
  const confirmationReady = confirmationTarget.length > 0 && confirmation.trim() === confirmationTarget;
  const confirmationHintId = `${idPrefix}-confirm-hint`;

  return (
    <ActionForm
      action={action}
      className="flex flex-col gap-4"
      onSuccess={setOutcome}
      onSubmit={(event) => {
        if (!confirmationReady) event.preventDefault();
      }}
    >
      {({ state, pending }) => (
        <>
          <input type="hidden" name="installationId" value={installationId} />
          <ScopeFields
            idPrefix={idPrefix}
            scope={scope}
            scopeId={scopeId}
            onScopeChange={setScope}
            onScopeIdChange={setScopeId}
          />

          {/* An explicit htmlFor/id pair rather than containment: the text sits two <span> levels
              deep, which is ambiguous to a checker and leaves the accessible name to the browser's
              own guess. The description is tied on with aria-describedby so it is announced as
              detail rather than folded into the name. */}
          <div className="flex items-start gap-2 text-sm">
            <input
              type="checkbox"
              id={`${idPrefix}-dry-run`}
              name="dryRun"
              defaultChecked
              className={`${checkboxClassName} mt-0.5`}
              aria-describedby={`${idPrefix}-dry-run-hint`}
            />
            <span>
              <label className="block" htmlFor={`${idPrefix}-dry-run`}>
                Preview what would be deleted
              </label>
              <span id={`${idPrefix}-dry-run-hint`} className="block text-meta text-muted-foreground">
                Records the request and reports the scope without removing anything.
              </span>
            </span>
          </div>

          <div className="flex flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={`${idPrefix}-confirm`}>
              {confirmationTarget ? (
                <>
                  Type <code className="font-mono">{confirmationTarget}</code> to confirm
                </>
              ) : (
                "Enter a scope id above before confirming"
              )}
            </label>
            <Input
              id={`${idPrefix}-confirm`}
              name="confirm"
              required
              autoComplete="off"
              value={confirmation}
              onChange={(event) => setConfirmation(event.currentTarget.value)}
              aria-describedby={confirmationHintId}
              aria-invalid={
                fieldError(state, "confirm") || (confirmation.length > 0 && !confirmationReady) ? true : undefined
              }
            />
            {fieldError(state, "confirm") ? (
              <p className="text-meta text-danger">{fieldError(state, "confirm")}</p>
            ) : null}
            <p id={confirmationHintId} className="text-meta text-muted-foreground">
              {confirmationTarget
                ? confirmationReady
                  ? "Confirmation matches. The request can now be submitted."
                  : `The request stays disabled until you type "${confirmationTarget}" exactly.`
                : "Choose a repository or user scope id first; the request stays disabled until that value is confirmed exactly."}
            </p>
          </div>

          <div>
            <Button
              type="submit"
              variant="destructive"
              className="button-delete"
              disabled={pending || !confirmationReady}
            >
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
