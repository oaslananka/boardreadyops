"use client";

import { useId, useState } from "react";
import { Dialog } from "./dialog.js";
import { Button } from "./ui/button.js";
import { Textarea } from "./ui/textarea.js";

/**
 * Proposes an audited waiver for one rule, from the page where the finding is.
 *
 * The capability was reachable only two ways: a `/boardreadyops waive` comment on the pull
 * request, or accepting a risk inside a review and taking the follow-up offer. Someone reading a
 * blocked run — the page that actually tells them what is wrong — had neither, so the answer to
 * "this finding is acceptable, now what" was to leave and look for somewhere else to say so.
 *
 * The reason floor is the product's, not this form's: `parseRepositoryActionRequest` refuses
 * anything under twenty characters, and `GitHubMutationService` writes it into the pull request
 * body. A waiver is a decision someone will read in six months, so a one-word reason is worse
 * than none.
 */

const minimumReasonLength = 20;

type WaiverResult = { ok: boolean; message: string; manageUrl?: string };

export function FindingWaiverButton({
  repositoryId,
  ruleId,
  alreadyWaived,
}: Readonly<{ repositoryId: string; ruleId: string; alreadyWaived: boolean }>) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<WaiverResult | null>(null);
  const titleId = useId();
  const reasonId = useId();

  // A finding already carrying a waiver has nothing to propose. Re-proposing would open a second
  // pull request for a decision that has been made.
  if (alreadyWaived) return null;

  function close() {
    setOpen(false);
    setReason("");
    setResult(null);
  }

  async function submit() {
    setPending(true);
    setResult(null);
    try {
      const response = await fetch(`/api/v1/repositories/${encodeURIComponent(repositoryId)}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "waive", ruleId, reason, requestId: `ui-waive-${ruleId}-${Date.now()}` }),
      });
      const data = (await response.json()) as Record<string, unknown>;
      if (!response.ok || data.ok !== true) {
        setResult({
          ok: false,
          message: typeof data.error === "string" ? data.error : "The waiver could not be requested.",
          ...(typeof data.manageUrl === "string" ? { manageUrl: data.manageUrl } : {}),
        });
        return;
      }
      setResult({
        ok: true,
        message:
          data.outcome === "duplicate"
            ? "That waiver is already queued."
            : "Waiver pull request queued. It appears on the repository for review.",
      });
    } catch {
      setResult({ ok: false, message: "The network request failed. Check your connection and try again." });
    } finally {
      setPending(false);
    }
  }

  const tooShort = reason.trim().length < minimumReasonLength;

  return (
    <>
      <Button type="button" variant="outline" size="sm" className="button-small" onClick={() => setOpen(true)}>
        Propose waiver
      </Button>
      {open ? (
        <Dialog titleId={titleId} onClose={close}>
          <div className="flex flex-col gap-4 p-5">
            <h2 id={titleId} className="text-heading font-semibold text-foreground">
              Accept the risk from <code>{ruleId}</code>?
            </h2>
            <p className="text-sm text-muted-foreground">
              This opens a pull request adding the waiver to your repository, so later runs honour it too. It changes
              nothing until someone reviews and merges it — and it does not silence this run.
            </p>

            <div>
              <label htmlFor={reasonId} className="text-sm font-medium text-foreground">
                Why is this acceptable?
              </label>
              <Textarea
                id={reasonId}
                value={reason}
                onChange={(event) => setReason(event.currentTarget.value)}
                rows={3}
                maxLength={500}
                placeholder="e.g. Fabricator confirmed 0.15 mm clearance is within their process window for this stackup."
                className="mt-1 w-full"
              />
              <p className="mt-1 text-meta text-muted-foreground">
                {tooShort
                  ? `At least ${minimumReasonLength} characters. Whoever reviews this pull request, and whoever reads it in six months, has only this sentence.`
                  : "Goes into the pull request body and the audit record."}
              </p>
            </div>

            {result ? (
              <output
                className={`rounded-md border p-2.5 text-sm ${
                  result.ok
                    ? "border-success/40 bg-success-surface text-foreground"
                    : "border-danger/40 bg-danger-surface text-foreground"
                }`}
              >
                {result.message}
                {result.manageUrl ? (
                  <>
                    {" "}
                    <a
                      href={result.manageUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="underline underline-offset-2"
                    >
                      Review the installation on GitHub →
                    </a>
                  </>
                ) : null}
              </output>
            ) : null}

            <div className="modal-footer flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={close}>
                {result?.ok ? "Close" : "Cancel"}
              </Button>
              {result?.ok ? null : (
                <Button type="button" disabled={pending || tooShort} onClick={() => void submit()}>
                  {pending ? "Requesting…" : "Open waiver pull request"}
                </Button>
              )}
            </div>
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
