"use client";

import type {
  clearSupplyFindingSuppressionAction,
  suppressSupplyFindingAction,
} from "../app/repositories/[repositoryId]/actions.js";
import { ActionForm } from "./ui/action-form.js";
import { Button } from "./ui/button.js";
import { Input } from "./ui/input.js";
import { NativeSelect } from "./ui/native-select.js";

function untilLabel(value: string): string {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? value : `${new Date(parsed).toISOString().replace("T", " ").slice(0, 16)} UTC`;
}

export function SupplyFindingSuppressionControl({
  repositoryId,
  findingId,
  suppressedUntil,
  suppressedBy,
  suppressionReason,
  suppressAction,
  clearAction,
}: Readonly<{
  repositoryId: string;
  findingId: string;
  suppressedUntil?: string | undefined;
  suppressedBy?: string | undefined;
  suppressionReason?: string | undefined;
  suppressAction: typeof suppressSupplyFindingAction;
  clearAction: typeof clearSupplyFindingSuppressionAction;
}>) {
  if (suppressedUntil) {
    return (
      <div className="flex min-w-56 flex-col gap-2">
        <p className="text-meta text-muted-foreground">
          Suppressed until {untilLabel(suppressedUntil)}
          {suppressedBy ? ` by ${suppressedBy}` : ""}
        </p>
        {suppressionReason ? <p className="text-meta text-muted-foreground">{suppressionReason}</p> : null}
        <ActionForm action={clearAction}>
          {({ pending }) => (
            <>
              <input type="hidden" name="repositoryId" value={repositoryId} />
              <input type="hidden" name="findingId" value={findingId} />
              <Button type="submit" size="sm" variant="outline" disabled={pending}>
                {pending ? "Resuming…" : "Resume alerts"}
              </Button>
            </>
          )}
        </ActionForm>
      </div>
    );
  }

  return (
    <ActionForm action={suppressAction} className="flex min-w-64 flex-col gap-2">
      {({ pending }) => (
        <>
          <input type="hidden" name="repositoryId" value={repositoryId} />
          <input type="hidden" name="findingId" value={findingId} />
          <Input
            name="reason"
            aria-label="Suppression reason"
            placeholder="Reason for temporary suppression"
            minLength={3}
            maxLength={500}
            required
            disabled={pending}
          />
          <NativeSelect name="duration" aria-label="Suppression duration" defaultValue="7d" disabled={pending}>
            <option value="1d">1 day</option>
            <option value="7d">7 days</option>
            <option value="30d">30 days</option>
          </NativeSelect>
          <Button type="submit" size="sm" variant="outline" disabled={pending}>
            {pending ? "Suppressing…" : "Suppress alerts"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}
