"use client";

import { useState } from "react";
import { type ParsedReviewBundle, parseReviewBundle, reviewBundleLimitBytes } from "./review-bundle-parser.js";

type PublishedReview = { url: string; label: string };

function safeReviewDestination(response: unknown): PublishedReview | undefined {
  if (!response || typeof response !== "object") return undefined;
  const result = response as Record<string, unknown>;
  if (result.ok !== true) return undefined;
  const destination =
    typeof result.reviewUrl === "string" && result.reviewUrl.startsWith("/reviews/")
      ? result.reviewUrl
      : typeof result.runId === "string" && /^[a-zA-Z0-9-]{1,80}$/u.test(result.runId)
        ? `/runs/${result.runId}/design`
        : undefined;
  if (!destination || !/^\/(reviews|runs)\/[a-zA-Z0-9-]+(?:\/design)?$/u.test(destination)) return undefined;
  return {
    url: destination,
    label: destination.startsWith("/reviews/") ? "Open published Review" : "Open existing Run",
  };
}

/**
 * Explicit user action only: selecting a local bundle previews it without a
 * request; pressing Publish transmits it using the existing GitHub session.
 */
export function ReviewBundlePublisher() {
  const [preview, setPreview] = useState<ParsedReviewBundle | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [published, setPublished] = useState<PublishedReview | null>(null);

  const chooseFile = async (file: File | undefined) => {
    setPreview(null);
    setFileName(null);
    setConsent(false);
    setError(null);
    setPublished(null);
    if (!file) return;
    if (file.size > reviewBundleLimitBytes) {
      setError("Review evidence exceeds 64 MiB. Use a smaller source-scoped bundle or the authorized CLI.");
      return;
    }
    try {
      const parsed = parseReviewBundle(JSON.parse(await file.text()) as unknown);
      setPreview(parsed);
      setFileName(file.name);
    } catch {
      setError(
        "This file is not a valid source-bound BoardReadyOps Review bundle. Generate a fresh bundle with the CLI.",
      );
    }
  };

  const publish = async () => {
    if (!preview || publishing || published || (preview.includesDesignArtwork && !consent)) return;
    setError(null);
    setPublishing(true);
    try {
      const response = await fetch("/api/v1/runs", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": preview.idempotencyKey,
        },
        body: JSON.stringify(preview.payload),
      });
      if (!response.ok) {
        setError(
          response.status === 401
            ? "Your GitHub session has expired. Sign in again, then choose the bundle."
            : response.status === 403
              ? "This GitHub session cannot publish to the selected repository. Check your installation access."
              : "The Review could not be published. Your local file is unchanged; check the source and try again.",
        );
        return;
      }
      const destination = safeReviewDestination(await response.json());
      if (!destination) {
        setError("The server did not return a valid Review link. Check the Review queue before retrying.");
        return;
      }
      setPublished(destination);
    } catch {
      setError("The Review upload did not complete. Check connectivity and the Review queue before retrying.");
    } finally {
      setPublishing(false);
    }
  };

  return (
    <section
      className="grid min-w-0 gap-5 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]"
      aria-label="Publish local Review evidence"
    >
      <div className="min-w-0 rounded-xl border border-border bg-card p-5 shadow-sm sm:p-7">
        <div className="mb-5 flex items-center gap-3">
          <span
            className="grid size-10 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-lg text-primary"
            aria-hidden="true"
          >
            1
          </span>
          <div>
            <h2 className="font-display text-lg font-semibold">Choose a Review evidence file</h2>
            <p className="text-sm text-muted-foreground">Your local design remains on your device until you publish.</p>
          </div>
        </div>
        <label htmlFor="review-evidence-file" className="mb-2 block text-sm font-medium">
          Review bundle (.json)
        </label>
        <input
          id="review-evidence-file"
          type="file"
          accept=".json,application/json"
          disabled={publishing}
          onChange={(event) => void chooseFile(event.currentTarget.files?.[0])}
          className="block min-h-11 w-full min-w-0 cursor-pointer rounded-lg border border-border bg-background p-2 text-sm text-foreground file:mr-3 file:cursor-pointer file:rounded-md file:border-0 file:bg-primary/15 file:px-3 file:py-2 file:font-semibold file:text-primary"
        />
        <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
          Only this chosen file is read. Nothing is uploaded while you are selecting or reviewing it. Maximum 64 MiB.
        </p>
        {error ? (
          <p className="mt-4 rounded-lg border border-destructive/40 p-3 text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
        {preview ? (
          <div className="mt-6 space-y-4 border-t border-border pt-5">
            <div className="flex items-center justify-between gap-3">
              <h3 className="font-semibold">Verify before publishing</h3>
              <span className="text-xs text-muted-foreground">Step 2 of 2</span>
            </div>
            <dl className="grid min-w-0 gap-x-4 gap-y-4 text-sm sm:grid-cols-2">
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">Review title</dt>
                <dd className="mt-1 break-words font-semibold">{preview.title}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">GitHub repository</dt>
                <dd className="mt-1 break-all font-medium">{preview.repository}</dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">Exact source commit</dt>
                <dd className="mt-1 break-all font-mono text-xs">{preview.commitSha}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Recorded findings</dt>
                <dd className="mt-1 font-semibold">
                  {preview.findingCount} recorded finding{preview.findingCount === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Blocking findings</dt>
                <dd className="mt-1 font-semibold">{preview.blockingCount} blocking</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Native PCB views</dt>
                <dd className="mt-1 font-semibold">
                  {preview.nativePcbViews} PCB layer{preview.nativePcbViews === 1 ? "" : "s"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Native schematics</dt>
                <dd className="mt-1 font-semibold">
                  {preview.nativeSchematicViews} sheet{preview.nativeSchematicViews === 1 ? "" : "s"}
                </dd>
              </div>
              <div className="min-w-0 sm:col-span-2">
                <dt className="text-muted-foreground">Evidence digest</dt>
                <dd className="mt-1 break-all font-mono text-xs">{preview.evidenceDigest}</dd>
              </div>
            </dl>
            {preview.includesDesignArtwork ? (
              <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-border bg-background p-3 text-sm leading-relaxed">
                <input
                  type="checkbox"
                  checked={consent}
                  onChange={(event) => {
                    setConsent(event.target.checked);
                  }}
                  className="mt-1 size-4 shrink-0 accent-primary"
                />
                <span>
                  I understand this file contains actual PCB routing and schematic artwork. Publishing uploads those
                  source-derived images to the selected repository's Review workspace.
                </span>
              </label>
            ) : (
              <p className="text-sm text-muted-foreground">
                This is a summary-only bundle; it does not contain native KiCad PCB or schematic drawings.
              </p>
            )}
            <button
              type="button"
              onClick={() => void publish()}
              disabled={publishing || !!published || (preview.includesDesignArtwork && !consent)}
              className="min-h-11 w-full rounded-lg bg-primary px-5 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {publishing ? "Publishing source-linked evidence…" : "Publish this Review"}
            </button>
            <p className="text-xs text-muted-foreground">
              A Review records reported evidence, not manufacturing approval. Existing critical findings remain
              blocking.
            </p>
            {published ? (
              <div role="status" className="space-y-2 rounded-lg border border-border p-3 text-sm">
                <p>Evidence published. Open the linked Review and inspect its exact source revision.</p>
                <a
                  className="inline-flex min-h-11 items-center text-primary underline underline-offset-4"
                  href={published.url}
                >
                  {published.label}
                </a>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
            {fileName
              ? `Selected: ${fileName}`
              : "No evidence selected yet. Select a file to inspect its source and artwork counts."}
          </div>
        )}
      </div>

      <aside
        className="min-w-0 self-start rounded-xl border border-border bg-card p-5 sm:p-7"
        aria-label="Create an evidence bundle locally"
      >
        <p className="text-xs font-semibold uppercase tracking-widest text-primary">From local design to real Review</p>
        <h2 className="mt-2 font-display text-xl font-semibold">Prepare the file on your machine</h2>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          BoardReadyOps scans your committed KiCad project locally. You choose whether to include detailed native
          drawings. No API token or source-repository upload is needed to create the file.
        </p>
        <pre className="mt-5 overflow-x-auto rounded-lg border border-border bg-background p-4 text-xs leading-relaxed">
          <code>{`boardreadyops review publish . \\
  --project hardware/board.kicad_pro \\
  --repo owner/repository \\
  --native-visuals \\
  --bundle review-evidence.json \\
  --server https://boardreadyops.com`}</code>
        </pre>
        <p className="mt-4 text-sm text-muted-foreground">
          Replace the project path and repository with your actual Git checkout. The bundle is created locally; choose
          it above, verify the source and press Publish only when ready.
        </p>
      </aside>
    </section>
  );
}
