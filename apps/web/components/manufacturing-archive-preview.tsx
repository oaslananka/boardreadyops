"use client";

import { ArrowUpRight, CheckCircle2, FileArchive, FileSpreadsheet, Layers3, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useId, useState } from "react";
import {
  inspectDownloadedManufacturingArchive,
  type ManufacturingArchiveContents,
} from "./manufacturing-archive-preview-parser.js";

type ArchiveEvidence = Readonly<{
  sha256: string;
  bytes: number;
  name: string;
  downloadUrl: string | undefined;
}>;

type PreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; contents: ManufacturingArchiveContents };

/**
 * The browser checks a local file against the already-authorized Run evidence.
 * The file never leaves the browser; we never claim a rendered Gerber is certified.
 */
export function ManufacturingArchivePreview({
  archive,
  sourceSha,
  runId,
}: Readonly<{ archive: ArchiveEvidence; sourceSha: string; runId: string }>) {
  const id = useId();
  const [state, setState] = useState<PreviewState>({ status: "idle" });

  const inspectFile = (file: File | undefined) => {
    if (!file) return;
    setState({ status: "loading" });
    void inspectDownloadedManufacturingArchive(file, {
      sha256: archive.sha256,
      bytes: archive.bytes,
      sourceSha,
    })
      .then((contents) => setState({ status: "ready", contents }))
      .catch((error: unknown) =>
        setState({
          status: "error",
          error: error instanceof Error ? error.message : "This archive could not be opened for review.",
        }),
      );
  };

  return (
    <section
      aria-labelledby={`${id}-title`}
      className="mt-5 overflow-hidden rounded-2xl border border-border bg-card shadow-e1"
    >
      <header className="flex flex-wrap items-start gap-3 border-b border-border bg-muted/30 px-5 py-5 sm:px-6">
        <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <FileArchive className="size-5" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-bold uppercase tracking-[0.12em] text-primary">
            Source-bound manufacturing package
          </p>
          <h2 id={`${id}-title`} className="mt-1 font-display text-xl font-semibold tracking-tight text-foreground">
            Preview your downloaded BOM and fabrication files
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-relaxed text-muted-foreground">
            Inspect the real file inventory and BOM before handing anything to a manufacturer. The browser checks the
            recorded SHA-256 and source commit. Your file is never uploaded to BoardReadyOps. This preview is not a
            fabrication approval.
          </p>
        </div>
      </header>

      <div className="space-y-4 px-5 py-5 sm:px-6">
        <ol className="grid gap-3 text-sm sm:grid-cols-2">
          <li className="rounded-xl border border-border bg-background/60 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              1 · Download the archive
            </p>
            {archive.downloadUrl ? (
              <a
                href={archive.downloadUrl}
                className="mt-2 inline-flex min-h-11 items-center gap-2 font-semibold text-primary underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              >
                Open the GitHub artifact ZIP <ArrowUpRight className="size-4" aria-hidden="true" />
              </a>
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">
                The recorded download is unavailable or expired. An already downloaded copy can still be checked.
              </p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              Extract the <code>.tar.gz</code> file inside the GitHub ZIP (usually{" "}
              <code>boardreadyops-manufacturing-export.tar.gz</code>), not the ZIP itself.
            </p>
          </li>
          <li className="rounded-xl border border-border bg-background/60 p-4">
            <label
              htmlFor={`${id}-file`}
              className="block text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              2 · Inspect the .tar.gz locally
            </label>
            <input
              id={`${id}-file`}
              type="file"
              accept=".gz,.tgz,application/gzip"
              aria-describedby={`${id}-description`}
              className="mt-2 block min-h-11 w-full min-w-0 cursor-pointer rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground file:mr-3 file:cursor-pointer file:border-0 file:bg-transparent file:font-semibold file:text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              onChange={(event) => {
                inspectFile(event.currentTarget.files?.[0]);
                event.currentTarget.value = "";
              }}
            />
            <p id={`${id}-description`} className="mt-2 text-xs text-muted-foreground">
              Checks the exact archive bytes against this Run. No new cloud storage or fabrication request.
            </p>
          </li>
        </ol>

        <div aria-live="polite" aria-atomic="true">
          {state.status === "loading" ? (
            <p role="status" className="text-sm font-medium text-primary">
              Checking archive integrity and source evidence…
            </p>
          ) : null}
          {state.status === "error" ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-foreground"
            >
              <strong>Preview not verified.</strong> {state.error}
            </div>
          ) : null}
          {state.status === "ready" ? <ArchiveContents contents={state.contents} runId={runId} /> : null}
        </div>
      </div>
    </section>
  );
}

function ArchiveContents({ contents, runId }: Readonly<{ contents: ManufacturingArchiveContents; runId: string }>) {
  const stats = [
    { label: "Gerber layer files", value: contents.gerberLayers.length, icon: Layers3 },
    { label: "Drill files", value: contents.drills.length, icon: FileArchive },
    { label: "BOM entries", value: contents.totalBomRows, icon: FileSpreadsheet },
    { label: "Placement rows", value: contents.positionRows, icon: ShieldCheck },
  ] as const;

  return (
    <div className="space-y-5" data-testid="verified-manufacturing-archive-preview">
      <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
          <CheckCircle2 className="size-5 text-primary" aria-hidden="true" />
          Recorded SHA-256 and source commit match
        </p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">{contents.sourceSha}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {contents.outputCount} manifest-listed output files were checked against their individual digests. The browser
          does not independently revalidate the Sigstore signature. This is not a fabrication approval.
        </p>
      </div>

      <section className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-label="Verified package file counts">
        {stats.map((stat) => (
          <div key={stat.label} className="rounded-xl border border-border bg-background/65 p-3">
            <div className="flex items-center gap-2 text-muted-foreground">
              <stat.icon className="size-4 shrink-0" aria-hidden="true" />
              <span className="text-xs">{stat.label}</span>
            </div>
            <p className="mt-2 text-2xl font-semibold tabular-nums text-foreground">{stat.value ?? "—"}</p>
          </div>
        ))}
      </section>

      <section aria-labelledby="archive-bom-title" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 id="archive-bom-title" className="text-base font-semibold text-foreground">
            Bill of materials
          </h3>
          <span className="text-xs text-muted-foreground">
            {contents.bomRows.length} of {contents.totalBomRows} rows shown
          </span>
        </div>
        {contents.bomRows.length > 0 ? (
          <section
            className="max-w-full overflow-x-auto rounded-xl border border-border"
            aria-label="Recorded bill of materials"
          >
            <table className="w-full min-w-[32rem] text-left text-sm">
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  {contents.bomHeaders.map((header) => (
                    <th key={header} scope="col" className="px-3 py-3 font-semibold">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {contents.bomRows.map((row) => (
                  <tr key={row.join("\u001f")} className="border-t border-border">
                    {contents.bomHeaders.map((header, column) => (
                      <td key={header} className="max-w-64 break-words px-3 py-3 text-foreground">
                        {row[column] ?? "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : (
          <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
            No BOM rows are included in this recorded manufacturing archive.
          </p>
        )}
      </section>

      <details className="rounded-xl border border-border bg-background/60">
        <summary className="flex min-h-11 cursor-pointer items-center px-4 py-3 text-sm font-semibold text-foreground">
          Gerber, drill and job file inventory (
          {contents.gerberLayers.length + contents.drills.length + contents.gerberJobs.length})
        </summary>
        <ul
          className="max-h-64 space-y-2 overflow-y-auto border-t border-border p-4 text-xs"
          aria-label="Manufacturing file inventory"
        >
          {[...contents.gerberLayers, ...contents.drills, ...contents.gerberJobs].map((file) => (
            <li key={file.name} className="flex flex-wrap items-baseline justify-between gap-2">
              <code className="break-all text-foreground">{file.name}</code>
              <span className="shrink-0 text-muted-foreground">{file.bytes.toLocaleString("en-US")} bytes</span>
            </li>
          ))}
        </ul>
      </details>
      <p className="text-sm text-muted-foreground">
        File inventory is not a plotted Gerber visualization. For source-derived PCB and schematic artwork, open{" "}
        <Link
          href={`/runs/${encodeURIComponent(runId)}/design`}
          className="font-semibold text-primary underline underline-offset-2 hover:underline"
        >
          this Run&apos;s design viewer
        </Link>
        . Validate the native fabrication outputs with your CAD/manufacturer before production.
      </p>
    </div>
  );
}
