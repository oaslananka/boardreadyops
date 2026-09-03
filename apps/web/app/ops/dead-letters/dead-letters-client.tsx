"use client";

import { useState } from "react";
import { Alert, Panel } from "../../../components/ui.js";
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

export function DeadLettersClient() {
  const [installationId, setInstallationId] = useState("");
  const [token, setToken] = useState("");
  const [state, setState] = useState<DeadLettersLoadState>("idle");
  const [error, setError] = useState<string | undefined>();
  const [items, setItems] = useState<DeadLetterListItem[]>([]);
  const [nextBefore, setNextBefore] = useState<string | undefined>();
  const [replayState, setReplayState] = useState<Record<string, ReplayRowState | undefined>>({});

  async function load(before?: string) {
    setState("loading");
    setError(undefined);
    try {
      const response = await fetch(buildDeadLetterListUrl({ installationId, ...(before ? { before } : {}) }), {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = (await response.json().catch(() => ({ ok: false, error: "Invalid response" }))) as ListResponse;
      if (!response.ok || !body.ok) {
        setError(!body.ok ? body.error : `Server returned error (${response.status})`);
        setState("error");
        return;
      }
      setItems((current) => (before ? [...current, ...body.items] : body.items));
      setNextBefore(body.nextBefore);
      setState("loaded");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error loading dead letters");
      setState("error");
    }
  }

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!installationId.trim() || !token.trim()) return;
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
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "idempotency-key": crypto.randomUUID(),
          },
        },
      );
      const body = (await response.json().catch(() => ({ ok: false, error: "Invalid response" }))) as ReplayResponse;
      if (!response.ok || !body.ok) {
        setReplayState((current) => ({
          ...current,
          [key]: { status: "failed", message: !body.ok ? body.error : `Server returned error (${response.status})` },
        }));
        return;
      }
      setReplayState((current) => ({
        ...current,
        [key]: { status: "done", message: replayOutcomeMessage(body.outcome) },
      }));
    } catch (err) {
      setReplayState((current) => ({
        ...current,
        [key]: { status: "failed", message: err instanceof Error ? err.message : "Network error" },
      }));
    }
  }

  return (
    <div className="dead-letters-workspace">
      <Panel title="Connect to an installation" description="Credentials are kept in memory for this page load only.">
        <form onSubmit={handleSubmit} className="policy-builder-form">
          <div className="form-grid-2">
            <div className="form-group">
              <label htmlFor="dead-letters-installation-id">Installation ID</label>
              <input
                id="dead-letters-installation-id"
                className="form-input"
                value={installationId}
                onChange={(event) => setInstallationId(event.currentTarget.value)}
                placeholder="ins_..."
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="dead-letters-operator-token">Operator bearer token</label>
              <input
                id="dead-letters-operator-token"
                className="form-input"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(event) => setToken(event.currentTarget.value)}
                placeholder="BOARDREADYOPS_OPERATOR_API_TOKEN"
                required
              />
            </div>
          </div>
          <footer className="modal-footer">
            <button type="submit" className="button button-primary" disabled={state === "loading"}>
              {state === "loading" ? "Loading…" : "Load dead letters"}
            </button>
          </footer>
        </form>
      </Panel>

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
