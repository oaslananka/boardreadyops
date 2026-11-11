"use client";

import { useId, useState } from "react";
import type { DemoComment, DemoFinding } from "../../lib/demo-data.js";
import { Button } from "../ui/button.js";
import { Panel } from "../ui.js";

export function DiscussionTab({
  comments,
  findings = [],
  viewerLogin,
  onAddComment,
  onToggleStatus,
  onInspectFinding,
  readOnly = false,
}: Readonly<{
  comments: DemoComment[];
  findings?: readonly DemoFinding[] | undefined;
  viewerLogin?: string | undefined;
  onAddComment?: (content: string) => void;
  onToggleStatus?: (commentId: string, nextStatus: "open" | "resolved") => void;
  onInspectFinding?: ((fingerprint: string) => void) | undefined;
  readOnly?: boolean | undefined;
}>) {
  const [newContent, setNewContent] = useState("");
  const commentFieldId = useId();
  const findingsByFingerprint = new Map(findings.map((finding) => [finding.fingerprint, finding]));

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = newContent.trim();
    if (!trimmed) return;
    onAddComment?.(trimmed);
    setNewContent("");
  }

  return (
    <div className="flex flex-col gap-4">
      <Panel title="Review Discussion & Threads" tone="raised">
        {/* `engineering-thread` carries no styling any more (its styles.css rule is gone) --
            it is kept as a stable selector hook for tests/unit/web/keyboard-triage.test.ts. */}
        <div className="engineering-thread flex flex-col gap-3">
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No comments posted yet.</p>
          ) : (
            comments.map((cmt) => (
              <div
                key={cmt.id}
                className={`rounded-md border border-border bg-card p-3 ${cmt.status === "outdated" ? "opacity-60" : ""}`}
              >
                <header className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-sm">
                    <span className="font-medium text-foreground">{cmt.authorId}</span>
                    <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                      {cmt.authorType}
                    </span>
                    {/* `comment-time` carries no styling any more -- kept as a stable selector
                        hook (Playwright visual-snapshot mask) for tests/e2e/visual.spec.ts. */}
                    <span className="comment-time text-xs text-muted-foreground">
                      {new Date(cmt.createdAt).toLocaleString()}
                    </span>
                  </div>
                  {/* `button-small` carries no styling any more -- kept as a stable selector hook
                      for tests/unit/web/discussion-tab.test.ts and
                      tests/e2e/regression-audit-findings.spec.ts. */}
                  {!readOnly ? (
                    <Button
                      type="button"
                      size="sm"
                      variant={cmt.status === "resolved" ? "secondary" : "ghost"}
                      className="button-small"
                      onClick={() => onToggleStatus?.(cmt.id, cmt.status === "resolved" ? "open" : "resolved")}
                      disabled={cmt.status === "outdated"}
                    >
                      {cmt.status === "resolved" ? "✓ Resolved" : "Mark Resolved"}
                    </Button>
                  ) : null}
                </header>

                <div className="mt-2 text-sm text-foreground">
                  <p>{cmt.content}</p>
                </div>

                {cmt.findingFingerprint ? (
                  <footer className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-2 text-xs text-muted-foreground">
                    {findingsByFingerprint.get(cmt.findingFingerprint) ? (
                      <>
                        <span>
                          Linked to recorded finding:{" "}
                          <strong className="font-medium text-foreground">
                            {findingsByFingerprint.get(cmt.findingFingerprint)?.ruleId}
                          </strong>
                        </span>
                        {onInspectFinding ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            aria-label={`Inspect recorded finding ${findingsByFingerprint.get(cmt.findingFingerprint)?.ruleId}`}
                            onClick={() => {
                              if (cmt.findingFingerprint) onInspectFinding(cmt.findingFingerprint);
                            }}
                          >
                            Inspect finding →
                          </Button>
                        ) : null}
                      </>
                    ) : (
                      <span>Linked finding is unavailable in this Review.</span>
                    )}
                  </footer>
                ) : null}
              </div>
            ))
          )}
        </div>

        {!readOnly ? (
          <form onSubmit={handlePost} className="mt-4 rounded-md border border-border bg-card p-3">
            <h4 className="text-sm font-bold text-foreground">Add to Discussion</h4>
            <label htmlFor={commentFieldId} className="sr-only">
              Comment
            </label>
            <textarea
              id={commentFieldId}
              rows={3}
              value={newContent}
              onChange={(e) => setNewContent(e.currentTarget.value)}
              placeholder="Leave an engineering review note or question..."
              className="mt-2 w-full rounded-sm border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
              required
            />
            <footer className="mt-2 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Commenting as {viewerLogin ?? "you"}</span>
              <Button type="submit">Post Comment</Button>
            </footer>
          </form>
        ) : null}
      </Panel>
    </div>
  );
}
