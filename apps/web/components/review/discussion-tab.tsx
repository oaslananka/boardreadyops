"use client";

import { useState } from "react";
import type { DemoComment } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";

export function DiscussionTab({
  comments: initialComments,
  onAddComment,
}: {
  comments: DemoComment[];
  onAddComment?: (comment: DemoComment) => void;
}) {
  const [comments, setComments] = useState(initialComments);
  const [newContent, setNewContent] = useState("");
  const [authorId, setAuthorId] = useState("engineer@company.com");

  function handlePost(e: React.FormEvent) {
    e.preventDefault();
    if (!newContent.trim()) return;

    const newComment: DemoComment = {
      id: `cmt_${Date.now()}`,
      authorId,
      authorType: "internal",
      content: newContent.trim(),
      status: "open",
      createdAt: new Date().toISOString(),
    };

    setComments((prev) => [...prev, newComment]);
    onAddComment?.(newComment);
    setNewContent("");
  }

  function handleToggleStatus(commentId: string) {
    setComments((prev) =>
      prev.map((c) => (c.id === commentId ? { ...c, status: c.status === "open" ? "resolved" : "open" } : c)),
    );
  }

  return (
    <div className="discussion-tab-content">
      <Panel title="Review Discussion & Threads">
        <div className="comment-timeline">
          {comments.length === 0 ? (
            <p className="empty-notice">No comments posted yet. Start the conversation below.</p>
          ) : (
            comments.map((cmt) => (
              <div key={cmt.id} className={`comment-card panel ${cmt.status}`}>
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
                      onClick={() => handleToggleStatus(cmt.id)}
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
          <textarea
            rows={3}
            value={newContent}
            onChange={(e) => setNewContent(e.currentTarget.value)}
            placeholder="Leave an engineering review note or question..."
            className="form-textarea"
            required
          />
          <footer className="comment-form-footer">
            <input
              type="email"
              value={authorId}
              onChange={(e) => setAuthorId(e.currentTarget.value)}
              className="form-input author-input"
              placeholder="Your email / ID"
              required
            />
            <button type="submit" className="button button-primary">
              Post Comment
            </button>
          </footer>
        </form>
      </Panel>
    </div>
  );
}
