"use client";

import { useId, useState } from "react";
import type { revokeDeliveryLinkAction } from "../../app/deliveries/actions.js";
import { Dialog } from "../dialog.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";

/**
 * Ends a guest delivery link now.
 *
 * A link minted here reads a signed manufacturing archive with no account, and until this existed
 * the only way to close one was to wait out its expiry — up to ninety days. A package sent to the
 * wrong fabricator stayed readable the whole time.
 *
 * Asks first, like every other irreversible control in the app. The link is expired rather than
 * deleted, so the delivery list still shows who was given what and when it was withdrawn.
 */
export function DeliveryRevokeButton({
  deliveryId,
  projectName,
  expired,
  action,
}: Readonly<{
  deliveryId: string;
  projectName: string;
  /** Already past its expiry; there is nothing left to revoke. */
  expired: boolean;
  action: typeof revokeDeliveryLinkAction;
}>) {
  const [confirming, setConfirming] = useState(false);
  const titleId = useId();

  if (expired) return null;

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="button-delete" onClick={() => setConfirming(true)}>
        Revoke
      </Button>
      {confirming ? (
        <Dialog titleId={titleId} onClose={() => setConfirming(false)}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Revoke the link for “{projectName}”?
            </h2>
            <p className="text-sm text-muted-foreground">
              The recipient loses access immediately, including anyone they forwarded it to. The link cannot be reopened
              — mint a new one instead. This delivery stays in the list, marked expired, so the record of what was
              shared survives.
            </p>
            <ActionForm action={action} onSuccess={() => setConfirming(false)}>
              {({ pending }) => (
                <div className="modal-footer flex justify-end gap-2">
                  <input type="hidden" name="deliveryId" value={deliveryId} />
                  <Button type="button" variant="outline" onClick={() => setConfirming(false)}>
                    Cancel
                  </Button>
                  <Button type="submit" variant="destructive" className="button-delete" disabled={pending}>
                    {pending ? "Revoking…" : "Revoke link"}
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
