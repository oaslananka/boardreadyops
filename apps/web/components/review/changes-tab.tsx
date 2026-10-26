import { customerStatusLabel } from "../../lib/customer-nomenclature.js";
import type { DemoReview } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";
import { ReviewDesignWorkspace } from "./review-design-workspace.js";

export function ChangesTab({ review }: { readonly review: DemoReview }) {
  const pcbs = review.changedFiles?.filter((f) => f.path.endsWith(".kicad_pcb")) ?? [];

  let pcbContent: React.ReactNode;
  if (review.changedFiles === undefined) {
    pcbContent = (
      <p className="text-sm text-muted-foreground">
        PCB surface change details are not available for this persisted review.
      </p>
    );
  } else if (pcbs.length === 0) {
    pcbContent = <p className="text-sm text-muted-foreground">No PCB files modified in this revision.</p>;
  } else {
    pcbContent = (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {pcbs.map((pcb) => (
          <div key={pcb.path} className="rounded-md border border-border bg-card p-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-foreground">{pcb.path.split("/").pop()}</h4>
              <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                {customerStatusLabel(pcb.status)}
              </span>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {pcb.changesCount} geometry/placement changes detected.
            </p>
          </div>
        ))}
      </div>
    );
  }

  let bomContent: React.ReactNode;
  if (review.bomChanges === undefined) {
    bomContent = (
      <p className="text-sm text-muted-foreground">
        BOM component delta details are not available for this persisted review.
      </p>
    );
  } else if (review.bomChanges.length === 0) {
    bomContent = <p className="text-sm text-muted-foreground">No BOM changes recorded for this revision.</p>;
  } else {
    bomContent = (
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-b border-border text-xs uppercase text-muted-foreground">
              <th className="py-2 pr-3">Component</th>
              <th className="py-2 pr-3">Change Type</th>
              <th className="py-2 pr-3">Base MPN</th>
              <th className="py-2 pr-3">Head MPN</th>
              <th className="py-2 pr-3">Manufacturer</th>
            </tr>
          </thead>
          <tbody>
            {review.bomChanges.map((change) => (
              <tr key={change.reference} className="border-b border-border last:border-b-0">
                <td className="py-2 pr-3">
                  <code>{change.reference}</code>
                </td>
                <td className="py-2 pr-3">
                  <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                    {customerStatusLabel(change.changeType)}
                  </span>
                </td>
                <td className="py-2 pr-3">{change.baseMpn ? <code>{change.baseMpn}</code> : "—"}</td>
                <td className="py-2 pr-3">
                  {change.headMpn ? <code>{change.headMpn}</code> : <span className="text-danger">Missing MPN</span>}
                </td>
                <td className="py-2 pr-3">{change.manufacturer ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      {review.pcbFootprintSummary ? (
        <section
          aria-label="Client-reported PCB footprint changes"
          className="rounded-lg border border-border bg-card p-4"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">PCB footprint changes</h3>
            <span className="rounded-sm bg-muted px-2 py-1 text-xs text-muted-foreground">
              Source-linked · client reported
            </span>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Counts for one selected KiCad PCB file, supplied by an authorized CLI from two Git versions. Other PCB
            files, tracks, vias and zones are not assessed. The server checks commit bindings and summary integrity, but
            has not independently examined the source design. Risk, DRC and manufacturing readiness are not evaluated.
          </p>
          <dl className="mt-3 grid grid-cols-3 gap-3 text-center sm:max-w-md">
            {(
              [
                ["Added", review.pcbFootprintSummary.changes.added],
                ["Removed", review.pcbFootprintSummary.changes.removed],
                ["Modified", review.pcbFootprintSummary.changes.modified],
              ] as const
            ).map(([name, count]) => (
              <div key={name} className="rounded-md border border-border bg-background p-2">
                <dt className="text-xs text-muted-foreground">{name}</dt>
                <dd className="text-xl font-semibold tabular-nums text-foreground">{count}</dd>
              </div>
            ))}
          </dl>
          <details className="mt-3 text-xs text-muted-foreground">
            <summary className="cursor-pointer py-2 font-medium text-primary">Show source-digest provenance</summary>
            <div className="mt-2 grid gap-2 break-all font-mono">
              <p>Base Git: {review.pcbFootprintSummary.baseCommitSha}</p>
              <p>Head Git: {review.pcbFootprintSummary.headCommitSha}</p>
              <p>Base source SHA-256: {review.pcbFootprintSummary.baseSourceSha256}</p>
              <p>Head source SHA-256: {review.pcbFootprintSummary.headSourceSha256}</p>
            </div>
          </details>
        </section>
      ) : null}

      <ReviewDesignWorkspace review={review} />

      <details className="rounded-lg border border-border bg-card">
        <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-foreground focus-visible:outline-2 focus-visible:outline-primary">
          Technical change details · PCB changes and BOM
        </summary>
        <div className="flex flex-col gap-4 p-3">
          <Panel
            title="PCB Layout & Stackup Changes"
            description="Copper traces, via placements, and keepout boundary modifications."
            tone="default"
          >
            {pcbContent}
          </Panel>

          <Panel title="Bill of Materials (BOM) Delta" tone="default">
            {bomContent}
          </Panel>
        </div>
      </details>
    </div>
  );
}
