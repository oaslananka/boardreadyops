"use client";

import { useId, useState } from "react";
import type { createTokenAction } from "../../app/settings/tokens/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { CopyButton } from "../copy-button.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { checkboxClassName } from "../ui/field.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

const scopeOptions = [
  { value: "runs:write", label: "runs:write", hint: "Ingest run results from CI or the CLI." },
  { value: "reviews:read", label: "reviews:read", hint: "Read reviews, findings, and readiness." },
  { value: "reviews:write", label: "reviews:write", hint: "Record decisions, comments, and approvals." },
  { value: "admin", label: "admin", hint: "Manage tokens and repository settings." },
] as const;

/**
 * The plaintext token exists in exactly one place: this component's state, for as long as the
 * dialog is open. It is never put in the URL, never sent back to the server, and never rendered
 * into the page behind the dialog — so a stray screenshot or a shared link cannot leak it.
 */
export function TokenCreateForm({
  repositoryId,
  action,
}: Readonly<{ repositoryId: string; action: typeof createTokenAction }>) {
  const [issued, setIssued] = useState<{ token: string; prefix: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const nameId = useId();
  const expiryId = useId();
  const titleId = useId();

  function close() {
    setIssued(null);
    setAcknowledged(false);
    // Remount the form so useActionState cannot hand the plaintext back on the next render.
    setFormKey((value) => value + 1);
  }

  return (
    <>
      <ActionForm key={formKey} action={action} className="flex flex-col gap-4" onSuccess={(data) => setIssued(data)}>
        {({ state, pending }) => (
          <>
            <input type="hidden" name="repositoryId" value={repositoryId} />

            <div className="flex flex-col gap-1.5">
              <label className="text-meta font-medium text-foreground" htmlFor={nameId}>
                Token name
              </label>
              <Input
                id={nameId}
                name="name"
                required
                maxLength={128}
                placeholder="ci-release-gate"
                aria-invalid={fieldError(state, "name") ? true : undefined}
              />
              {fieldError(state, "name") ? (
                <p className="text-meta text-danger">{fieldError(state, "name")}</p>
              ) : (
                <p className="text-meta text-muted-foreground">Shown in the token list so you can tell them apart.</p>
              )}
            </div>

            <fieldset className="flex flex-col gap-2">
              <legend className="text-meta font-medium text-foreground">Scopes</legend>
              {scopeOptions.map((scope) => (
                <label key={scope.value} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="scopes"
                    value={scope.value}
                    defaultChecked={scope.value !== "admin"}
                    className={`${checkboxClassName} mt-0.5`}
                  />
                  <span>
                    <code className="font-mono">{scope.label}</code>
                    <span className="block text-meta text-muted-foreground">{scope.hint}</span>
                  </span>
                </label>
              ))}
              {fieldError(state, "scopes") ? (
                <p className="text-meta text-danger">{fieldError(state, "scopes")}</p>
              ) : null}
            </fieldset>

            <div className="flex flex-col gap-1.5">
              <label className="text-meta font-medium text-foreground" htmlFor={expiryId}>
                Expires
              </label>
              <NativeSelect id={expiryId} name="durationDays" defaultValue="90">
                <option value="30">In 30 days</option>
                <option value="90">In 90 days</option>
                <option value="365">In 365 days</option>
                <option value="never">Never</option>
              </NativeSelect>
              {fieldError(state, "durationDays") ? (
                <p className="text-meta text-danger">{fieldError(state, "durationDays")}</p>
              ) : null}
            </div>

            <div>
              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create token"}
              </Button>
            </div>
          </>
        )}
      </ActionForm>

      {issued ? (
        <Dialog titleId={titleId} onClose={close}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Copy your new token
            </h2>
            <AlertRoot variant="danger">
              <AlertTitle>This is the only time this token will be shown</AlertTitle>
              <AlertDescription>
                BoardReadyOps stores only a SHA-256 digest. If you lose it, revoke this token and create another.
              </AlertDescription>
            </AlertRoot>
            <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-2">
              <code className="min-w-0 flex-1 break-all font-mono text-sm">{issued.token}</code>
              <CopyButton value={issued.token} label="Copy token" />
            </div>
            <p className="text-meta text-muted-foreground">
              Pass it as <code className="font-mono">BOARDREADYOPS_TOKEN</code> or on stdin — never as a command-line
              argument, where it would land in shell history and process listings.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className={checkboxClassName}
                checked={acknowledged}
                onChange={(event) => setAcknowledged(event.target.checked)}
              />
              I have saved this token somewhere safe
            </label>
            <div className="modal-footer flex justify-end">
              <Button type="button" disabled={!acknowledged} onClick={close}>
                Done
              </Button>
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
