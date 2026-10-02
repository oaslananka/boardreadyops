"use client";

import type { ValidatedRevisionCandidate } from "@boardreadyops/db";
import { useRouter } from "next/navigation";
import { useId } from "react";
import type { registerValidatedRevisionAction } from "../../app/deliveries/actions.js";
import { fieldError } from "../../lib/action-result.js";
import { ActionForm } from "../ui/action-form.js";
import { Button } from "../ui/button.js";
import { Input } from "../ui/input.js";
import { NativeSelect } from "../ui/native-select.js";

function candidateValue(candidate: ValidatedRevisionCandidate): string {
  return `${candidate.projectId}|${candidate.runId}|${candidate.artifactId}`;
}

function candidateLabel(candidate: ValidatedRevisionCandidate): string {
  return `${candidate.projectName} · ${candidate.artifactName} · ${candidate.commitSha.slice(0, 12)}`;
}

export function ValidatedRevisionRegisterForm({
  workspaceId,
  candidates,
  action,
}: Readonly<{
  workspaceId: string;
  candidates: readonly ValidatedRevisionCandidate[];
  action: typeof registerValidatedRevisionAction;
}>) {
  const router = useRouter();
  const candidateId = useId();
  const labelId = useId();

  return (
    <ActionForm
      action={action}
      onSuccess={() => {
        router.refresh();
      }}
      className="grid max-w-3xl gap-4 md:grid-cols-[minmax(0,1fr)_minmax(12rem,0.45fr)_auto] md:items-end"
    >
      {({ state, pending }) => (
        <>
          <input type="hidden" name="workspaceId" value={workspaceId} />

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={candidateId}>
              Validated manufacturing package
            </label>
            <NativeSelect id={candidateId} name="candidate" required>
              {candidates.map((candidate) => (
                <option key={candidate.artifactId} value={candidateValue(candidate)}>
                  {candidateLabel(candidate)}
                </option>
              ))}
            </NativeSelect>
            <p className="text-meta text-muted-foreground">
              Candidates come only from completed passing BoardReadyOps runs with a persisted manufacturing archive.
            </p>
            {fieldError(state, "candidate") ? (
              <p className="text-meta text-danger">{fieldError(state, "candidate")}</p>
            ) : null}
          </div>

          <div className="flex min-w-0 flex-col gap-1.5">
            <label className="text-meta font-medium text-foreground" htmlFor={labelId}>
              Revision label
            </label>
            <Input id={labelId} name="revisionLabel" required maxLength={64} placeholder="rev C" />
            {fieldError(state, "revisionLabel") ? (
              <p className="text-meta text-danger">{fieldError(state, "revisionLabel")}</p>
            ) : null}
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Registering…" : "Register revision"}
          </Button>

          {state.status === "error" ? <p className="text-sm text-danger md:col-span-3">{state.error}</p> : null}
        </>
      )}
    </ActionForm>
  );
}
