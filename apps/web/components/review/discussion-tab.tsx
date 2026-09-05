"use client";

import { useId, useState } from "react";
import type { DemoComment } from "../../lib/demo-data.js";
import { Button } from "../ui/button.js";
import { Panel } from "../ui.js";

export function DiscussionTab({
  comments,
  viewerLogin,
  onAddComment,
  onToggleStatus,
}: {
  comments: DemoComment[];
  viewerLogin?: string | undefined;
  onAddComment?: (content: string) => void;
  onToggleStatus?: (commentId: string, nextStatus: "open" | "resolved") => void;
}) {
  const [newContent, setNewContent] = useState("");
  const commentFieldId = useId();

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
            <p className="text-sm text-muted-foreground">No comments posted yet. Start the conversation below.</p>
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
                </header>

                <div className="mt-2 text-sm text-foreground">
                  <p>{cmt.content}</p>
                </div>

                {cmt.findingFingerprint ? (
                  <footer className="mt-2 text-xs text-muted-foreground">
                    <span>Anchored to Finding: </span>
                    <code>{cmt.findingFingerprint}</code>
                  </footer>
                ) : null}
              </div>
            ))
          )}
        </div>

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
      </Panel>
    </div>
  );
}
