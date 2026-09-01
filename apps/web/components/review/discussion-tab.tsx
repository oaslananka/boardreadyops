"use client";

import { useId, useState } from "react";
import type { DemoComment } from "../../lib/demo-data.js";
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
    <div className="discussion-tab-content">
      <Panel title="Review Discussion & Threads" tone="raised">
        <div className="engineering-thread comment-timeline">
          {comments.length === 0 ? (
            <p className="empty-notice">No comments posted yet. Start the conversation below.</p>
          ) : (
            comments.map((cmt) => (
              <div key={cmt.id} className={`comment-card panel surface-default ${cmt.status}`}>
                <header className="comment-header">
                  <div className="comment-author-info">
                    <span className="author-name">{cmt.authorId}</span>
                    <span className={`author-badge ${cmt.authorType}`}>{cmt.authorType}</span>
                    <span className="comment-time">{new Date(cmt.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="comment-status-action">
                    <button
                      type="button"
                      className={`button button-small ${cmt.status === "resolved" ? "button-secondary" : "button-ghost"}`}
                      onClick={() => onToggleStatus?.(cmt.id, cmt.status === "resolved" ? "open" : "resolved")}
                      disabled={cmt.status === "outdated"}
                    >
                      {cmt.status === "resolved" ? "✓ Resolved" : "Mark Resolved"}
                    </button>
                  </div>
                </header>

                <div className="comment-body">
                  <p>{cmt.content}</p>
                </div>

                {cmt.findingFingerprint ? (
                  <footer className="comment-anchor-footer">
                    <span className="anchor-label">Anchored to Finding:</span>
                    <code className="anchor-fingerprint">{cmt.findingFingerprint}</code>
                  </footer>
                ) : null}
              </div>
            ))
          )}
        </div>

        <form onSubmit={handlePost} className="new-comment-form panel">
          <h4>Add to Discussion</h4>
          <label htmlFor={commentFieldId}>Comment</label>
          <textarea
            id={commentFieldId}
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.currentTarget.value)}
            placeholder="Leave an engineering review note or question..."
            className="form-textarea"
            required
          />
          <footer className="comment-form-footer">
            <span className="comment-author-identity">Commenting as {viewerLogin ?? "you"}</span>
            <button type="submit" className="button button-primary">
              Post Comment
            </button>
          </footer>
        </form>
      </Panel>
    </div>
  );
}
