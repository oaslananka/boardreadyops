"use client";

import { useCallback, useState } from "react";
import { Button } from "./ui/button.js";

/**
 * The run actions that used to exist only as pull request slash commands.
 *
 * A maintainer looking at a blocked run had no way to act on it from here: the page told them to
 * "push an updated commit to trigger re-analysis in GitHub Actions", and everything else
 * (`rerun`, `release-preview`, `waive`) required leaving for a GitHub comment box. These buttons
 * post to the session-authenticated action route, which enqueues the identical lifecycle action
 * the slash command would have.
 *
 * Deliberately optimistic about permissions: when the installation's grants cannot be read the
 * buttons stay enabled and the server answers with the authoritative refusal, because a button
 * that silently vanished because GitHub was unreachable teaches the viewer nothing.
 */

export type RunActionBarProps = {
  repositoryId: string;
  runId: string;
  /** A run from a branch push has no pull request to report a re-run onto. */
  hasPullRequest: boolean;
  /** Why the dispatch capability is unavailable for this installation, when it is. */
  dispatchBlockedReason?: string;
};

type ActionState =
  | { status: "idle" }
  | { status: "working"; action: string }
  | { status: "done"; message: string }
  | { status: "error"; message: string; manageUrl?: string };

const labels: Record<string, { pending: string; done: string }> = {
  rerun: { pending: "Queueing re-run…", done: "Re-run queued. The new run appears in this repository's history." },
  "release-preview": {
    pending: "Building preview…",
    done: "Release preview queued. The checklist and package draft appear on the pull request.",
  },
};

export function RunActionBar({
  repositoryId,
  runId,
  hasPullRequest,
  dispatchBlockedReason,
}: Readonly<RunActionBarProps>) {
  const [state, setState] = useState<ActionState>({ status: "idle" });

  const run = useCallback(
    async (action: "release-preview" | "rerun") => {
      setState({ status: "working", action });
      try {
        const response = await fetch(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/actions`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action, runId, requestId: `ui-${action}-${Date.now()}` }),
        });
        const data = (await response.json()) as Record<string, unknown>;
        if (!response.ok || data.ok !== true) {
          setState({
            status: "error",
            message: typeof data.error === "string" ? data.error : "The request could not be completed.",
            ...(typeof data.manageUrl === "string" ? { manageUrl: data.manageUrl } : {}),
          });
          return;
        }
        const alreadyQueued = data.outcome === "duplicate";
        setState({
          status: "done",
          message: alreadyQueued
            ? "That request is already queued — nothing was started twice."
            : (labels[action]?.done ?? "Request queued."),
        });
      } catch {
        setState({ status: "error", message: "The network request failed. Check your connection and try again." });
      }
    },
    [repositoryId, runId],
  );

  const working = state.status === "working";
  const disabled = working || !hasPullRequest || dispatchBlockedReason !== undefined;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" disabled={disabled} onClick={() => run("rerun")}>
          {working && state.action === "rerun" ? labels.rerun?.pending : "Re-run readiness"}
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => run("release-preview")}>
          {working && state.action === "release-preview" ? labels["release-preview"]?.pending : "Preview release"}
        </Button>
      </div>

      {!hasPullRequest ? (
        <p className="text-meta text-muted-foreground">
          This run came from a branch push. Open a pull request for the branch to re-run or preview a release from here.
        </p>
      ) : null}

      {dispatchBlockedReason ? <p className="text-meta text-muted-foreground">{dispatchBlockedReason}</p> : null}

      {state.status === "done" || state.status === "error" ? (
        <output
          className={`rounded-md border p-2.5 text-sm ${
            state.status === "done"
              ? "border-success/40 bg-success-surface text-foreground"
              : "border-danger/40 bg-danger-surface text-foreground"
          }`}
        >
          {state.message}
          {state.status === "error" && state.manageUrl ? (
            <>
              {" "}
              <a href={state.manageUrl} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                Review the installation on GitHub →
              </a>
            </>
          ) : null}
        </output>
      ) : null}
    </div>
  );
}
