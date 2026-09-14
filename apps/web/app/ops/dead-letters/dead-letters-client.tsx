"use client";

import { useState } from "react";
import { Button } from "../../../components/ui/button.js";
import { NativeSelect } from "../../../components/ui/native-select.js";
import { Alert, EmptyState, Panel } from "../../../components/ui.js";
import { describeApiFailure, describeNetworkFailure } from "../../../lib/api-error-message.js";
import {
  buildDeadLetterListUrl,
  buildDeadLetterReplayUrl,
  type DeadLetterListItem,
  type DeadLetterReplayOutcome,
  replayOutcomeMessage,
} from "./dead-letter-view-model.js";
import { type DeadLettersLoadState, DeadLettersPanel, type ReplayRowState } from "./dead-letters-panel.js";

type ListResponse = { ok: true; items: DeadLetterListItem[]; nextBefore?: string } | { ok: false; error: string };
type ReplayResponse = { ok: true; outcome: DeadLetterReplayOutcome } | { ok: false; error: string };

function rowKey(item: Pick<DeadLetterListItem, "itemId" | "itemType">): string {
  return `${item.itemType}:${item.itemId}`;
}

/**
 * The dead-letter queue, read as the signed-in viewer.
 *
 * This panel used to ask for `BOARDREADYOPS_OPERATOR_API_TOKEN` in a text field, which meant the
 * only way to look at your own stuck jobs was to paste a control-plane credential into a browser
 * form. The route now also accepts the viewer session, scoped to the installations the session
 * covers, so the ordinary case needs no credential at all. An on-call operator working across
 * installations still uses the bearer token against the API directly.
 */
export function DeadLettersClient({
  installations = [],
}: Readonly<{ installations?: readonly { id: string; accountLogin: string }[] }>) {
  const [installationId, setInstallationId] = useState(installations[0]?.id ?? "");
  const [state, setState] = useState<DeadLettersLoadState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [items, setItems] = useState<DeadLetterListItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [replayState, setReplayState] = useState<Record<string, ReplayRowState | undefined>>({});

  async function load(before?: string) {
    setState("loading");
    setError(undefined);
    try {
      // Credentials ride on the session cookie; no Authorization header is constructed here.
      const response = await fetch(buildDeadLetterListUrl({ installationId, ...(before ? { before } : {}) }));
      const body = (await response.json().catch(() => ({ ok: false, error: "Invalid response" }))) as ListResponse;
      if (!response.ok || !body.ok) {
        setError(describeApiFailure(response.status, body.ok ? undefined : body.error, "this queue").message);
        setState("error");
        return;
      }
      setItems((current) => (before ? [...current, ...body.items] : body.items));
      setNextBefore(body.nextBefore);
      setState("loaded");
    } catch {
      setError(describeNetworkFailure().message);
      setState("error");
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!installationId.trim()) return;
    setItems([]);
    setNextBefore(undefined);
    setReplayState({});
    void load();
  }

  async function handleReplay(item: DeadLetterListItem) {
    const key = rowKey(item);
    setReplayState((current) => ({ ...current, [key]: { status: "pending" } }));
    try {
      const response = await fetch(
        buildDeadLetterReplayUrl({ installationId: item.installationId, itemType: item.itemType, itemId: item.itemId }),
        { method: "POST", headers: { "idempotency-key": crypto.randomUUID() } },
      );
      const body = (await response.json().catch(() => ({ ok: false, error: "Invalid response" }))) as ReplayResponse;
      if (!response.ok || !body.ok) {
        setReplayState((current) => ({
          ...current,
          [key]: {
            status: "failed",
            message: describeApiFailure(response.status, body.ok ? undefined : body.error, "this job").message,
          },
        }));
        return;
      }
      setReplayState((current) => ({
        ...current,
        [key]: { status: "done", message: replayOutcomeMessage(body.outcome) },
      }));
    } catch {
      setReplayState((current) => ({
        ...current,
        [key]: { status: "failed", message: describeNetworkFailure().message },
      }));
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {installations.length === 0 ? (
        <Panel title="Pick an installation">
          <EmptyState title="No installation is available to you">
            <p>
              Sign in with an account whose GitHub App installations you administer. An on-call operator working across
              installations uses the operator bearer token against the API directly rather than this page.
            </p>
          </EmptyState>
        </Panel>
      ) : (
        <Panel
          title="Pick an installation"
          description="Scoped to the installations your account administers. No credential is entered here."
        >
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-60 flex-1">
              <label htmlFor="dead-letters-installation-id" className="text-sm font-medium text-foreground">
                Installation
              </label>
              <NativeSelect
                id="dead-letters-installation-id"
                className="mt-1 w-full"
                value={installationId}
                onChange={(event) => setInstallationId(event.currentTarget.value)}
                required
              >
                {installations.map((installation) => (
                  <option key={installation.id} value={installation.id}>
                    {installation.accountLogin}
                  </option>
                ))}
              </NativeSelect>
            </div>
            <Button type="submit" disabled={state === "loading"}>
              {state === "loading" ? "Loading…" : "Load dead letters"}
            </Button>
          </form>
        </Panel>
      )}

      <Panel title="Dead letters" description="Jobs and outbox records the control plane could not deliver.">
        <DeadLettersPanel
          state={state}
          {...(error ? { error } : {})}
          items={items}
          hasMore={Boolean(nextBefore)}
          onLoadMore={() => void load(nextBefore)}
          onReplay={(item) => void handleReplay(item)}
          replayState={replayState}
        />
      </Panel>

      <Alert title="Metadata-only surface" tone="info">
        <p>
          Replay only records the API reports as safe. An uncertain dispatch without a persisted workflow run ID stays
          non-replayable and needs a reconciliation path or manual incident decision — see{" "}
          <code>docs/operations/control-plane-reconciliation.md</code>.
        </p>
      </Alert>
    </div>
  );
}
