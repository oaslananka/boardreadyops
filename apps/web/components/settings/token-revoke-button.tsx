"use client";

import { useId, useState } from "react";
import type { revokeTokenAction } from "../../app/settings/tokens/actions.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";

/**
 * Revocation is immediate and cannot be undone, so it asks first — the same confirm-then-act
 * shape the policy delete already uses.
 */
export function TokenRevokeButton({
  repositoryId,
  tokenId,
  tokenName,
  action,
}: Readonly<{ repositoryId: string; tokenId: string; tokenName: string; action: typeof revokeTokenAction }>) {
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="button-small" onClick={() => setConfirming(true)}>
        Revoke
      </Button>
      {confirming ? (
        <Dialog titleId={titleId} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Revoke “{tokenName}”?
            </h2>
            <p className="text-sm text-muted-foreground">
              Anything still authenticating with this token starts failing immediately. This cannot be undone.
            </p>
            <ActionForm action={action} onSuccess={() => setConfirming(false)}>
              {({ pending }) => (
                <div className="modal-footer flex justify-end gap-2">
                  <input type="hidden" name="repositoryId" value={repositoryId} />
                  <input type="hidden" name="tokenId" value={tokenId} />
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" className="button-delete" disabled={pending}>
                    {pending ? "Revoking…" : "Revoke token"}
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
