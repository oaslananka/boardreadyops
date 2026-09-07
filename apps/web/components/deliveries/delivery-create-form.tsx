"use client";

import { useId, useState } from "react";
import type { createDeliveryLinkAction } from "../../app/deliveries/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { CopyButton } from "../copy-button.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../ui/alert.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

export type RevisionOption = Readonly<{ id: string; label: string }>;

/**
 * The guest URL exists in exactly one place: this component's state, for as long as the dialog is
 * open. Only the token's hash is stored, so nothing can recover the link afterwards -- which is
 * the point, and also why the dialog says so rather than letting someone close it and find out.
 */
export function DeliveryCreateForm({
  revisions,
  origin,
  action,
}: Readonly<{
  revisions: readonly RevisionOption[];
  /** Absolute origin, so the copied value is a URL a recipient can open, not a bare path. */
  origin: string;
  action: typeof createDeliveryLinkAction;
}>) {
  const [issued, setIssued] = useState<{ url: string; expiresAt: string } | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [formKey, setFormKey] = useState(0);
  const revisionId = useId();
  const urlId = useId();
  const notesId = useId();
  const expiryId = useId();
  const titleId = useId();

  function close() {
    setIssued(null);
    setAcknowledged(false);
    // Remount, so useActionState cannot hand the link back on the next render.
    setFormKey((value) => value + 1);
  }

  return (
    <>
      <ActionForm
        key={formKey}
        action={action}
        className="flex flex-col gap-4"
        onSuccess={(data) => {
          setIssued({ url: `${origin}/deliveries/${data.token}`, expiresAt: data.expiresAt });
        }}
      >
        {({ state, pending }) => (
          <>
            <div className="flex flex-col gap-1.5">
              <label className="text-meta font-medium text-foreground" htmlFor={revisionId}>
                Revision
              </label>
              <NativeSelect id={revisionId} name="revisionId" required>
                {revisions.map((revision) => (
                  <option key={revision.id} value={revision.id}>
                    {revision.label}
                  </option>
                ))}
              </NativeSelect>
              {fieldError(state, "revisionId") ? (
                <p className="text-meta text-danger">{fieldError(state, "revisionId")}</p>
              ) : null}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-meta font-medium text-foreground" htmlFor={urlId}>
                Signed archive URL
              </label>
              <Input
                id={urlId}
                name="signedArchiveUrl"
                type="url"
                maxLength={2048}
                required
                placeholder="https://storage.example.com/gateway-rev-c.zip"
                aria-describedby={`${urlId}-hint`}
              />
              <p id={`${urlId}-hint`} className="text-meta text-muted-foreground">
                Where the recipient downloads the package. The link below grants access to this URL.
              </p>
              {fieldError(state, "signedArchiveUrl") ? (
                <p className="text-meta text-danger">{fieldError(state, "signedArchiveUrl")}</p>
              ) : null}
            </div>

            <div className="flex flex-wrap items-end gap-3">
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <label className="text-meta font-medium text-foreground" htmlFor={notesId}>
                  Notes for the recipient <span className="font-normal text-muted-foreground">(optional)</span>
                </label>
                <Input id={notesId} name="recipientNotes" maxLength={2048} placeholder="Fab notes, revision context" />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-meta font-medium text-foreground" htmlFor={expiryId}>
                  Expires in
                </label>
                <NativeSelect id={expiryId} name="expiresInDays" defaultValue="7">
                  <option value="1">1 day</option>
                  <option value="7">7 days</option>
                  <option value="30">30 days</option>
                  <option value="90">90 days</option>
                </NativeSelect>
              </div>

              <Button type="submit" disabled={pending}>
                {pending ? "Creating…" : "Create guest link"}
              </Button>
            </div>
          </>
        )}
      </ActionForm>

      {issued ? (
        <Dialog titleId={titleId} onClose={close}>
          <h2 id={titleId} className="text-title font-bold text-foreground">
            Guest link created
          </h2>
          <AlertRoot variant="danger" className="mt-3">
            <AlertTitle>This is the only time this link will be shown</AlertTitle>
            <AlertDescription>
              Only its hash is stored, so it cannot be recovered — a lost link can only be replaced by a new one. Anyone
              holding it can download the archive until {new Date(issued.expiresAt).toISOString().slice(0, 10)}.
            </AlertDescription>
          </AlertRoot>
          <div className="mt-3 flex items-center gap-2 rounded-md border border-border bg-muted p-3">
            <code className="min-w-0 flex-1 break-all font-mono text-sm">{issued.url}</code>
            <CopyButton value={issued.url} label="Copy guest link" />
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={acknowledged}
              onChange={(event) => setAcknowledged(event.currentTarget.checked)}
            />
            <span>I have saved this link</span>
          </label>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={close} disabled={!acknowledged}>
              Close
            </Button>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
