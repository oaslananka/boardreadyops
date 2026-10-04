"use client";

import type { acknowledgeSupplyFindingAction } from "../app/repositories/[repositoryId]/actions.js";
import { ActionForm } from "./ui/action-form.js";
import { Button } from "./ui/button.js";

export function SupplyFindingAcknowledgeButton({
  repositoryId,
  findingId,
  action,
}: Readonly<{
  repositoryId: string;
  findingId: string;
  action: typeof acknowledgeSupplyFindingAction;
}>) {
  return (
    <ActionForm action={action}>
      {({ pending }) => (
        <>
          <input type="hidden" name="repositoryId" value={repositoryId} />
          <input type="hidden" name="findingId" value={findingId} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Acknowledging…" : "Acknowledge"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
