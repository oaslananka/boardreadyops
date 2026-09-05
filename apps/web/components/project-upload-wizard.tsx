"use client";

import Link from "next/link";
import { useState } from "react";

export type ProjectUploadWizardProps = Readonly<{
  workspaceId?: string;
  onComplete?: (reviewId: string) => void;
}>;

type SourceMode = "zip" | "github" | "cli";

export function ProjectUploadWizard({ workspaceId: _workspaceId = "default" }: ProjectUploadWizardProps) {
  const [sourceMode, setSourceMode] = useState<SourceMode>("zip");

  return (
    <div className="project-upload-wizard">
      <div className="source-tabs" role="tablist" aria-label="Ingestion Source">
        <button
          type="button"
          role="tab"
          className={`source-tab-button ${sourceMode === "zip" ? "active" : ""}`}
          aria-selected={sourceMode === "zip"}
          onClick={() => setSourceMode("zip")}
        >
          Upload Package (Zip)
        </button>
        <button
          type="button"
          role="tab"
          className={`source-tab-button ${sourceMode === "github" ? "active" : ""}`}
          aria-selected={sourceMode === "github"}
          onClick={() => setSourceMode("github")}
        >
          Connect GitHub Repository
        </button>
        <button
          type="button"
          role="tab"
          className={`source-tab-button ${sourceMode === "cli" ? "active" : ""}`}
          aria-selected={sourceMode === "cli"}
          onClick={() => setSourceMode("cli")}
        >
          Run Local CLI
        </button>
      </div>

      {sourceMode === "zip" && (
        <div className="zip-source-panel" role="tabpanel">
          <p>
            Hosted package upload is not available yet — the ingestion backend for direct .zip uploads isn't connected.
          </p>
          <p className="upload-unavailable-hint">
            Use <strong>Connect GitHub Repository</strong> or <strong>Run Local CLI</strong> to run a pre-flight review
            today.
          </p>
        </div>
      )}

      {sourceMode === "github" && (
        <div className="github-source-panel" role="tabpanel">
          <p>
            Connect your GitHub organization or personal repository to run automated BoardReadyOps verdict checks
            directly on pull requests and commit pushes.
          </p>
          <Link href="/setup" className="github-setup-link button button-primary">
            Connect GitHub App
          </Link>
        </div>
      )}

      {sourceMode === "cli" && (
        <div className="cli-source-panel" role="tabpanel">
          <p>
            Run local-first pre-flight checks on your engineering workstation before committing or sharing manufacturing
            packages:
          </p>
          <pre className="cli-instruction-code">
            <code>npx boardreadyops review</code>
          </pre>
          <p className="cli-hint">
            The CLI detects KiCad, Altium, and Gerber packages locally and generates offline HTML, JSON, and markdown
            reports.
          </p>
        </div>
      )}
    </div>
  );
}
