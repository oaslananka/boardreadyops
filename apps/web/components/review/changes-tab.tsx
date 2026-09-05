import type { DemoReview } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";
import { ReviewCanvas } from "./review-canvas.js";

export function ChangesTab({ review }: { readonly review: DemoReview }) {
  const pcbs = review.changedFiles?.filter((f) => f.path.endsWith(".kicad_pcb")) ?? [];

  let canvasContent: React.ReactNode;
  if (!review.headSnapshots || review.headSnapshots.length === 0) {
    canvasContent = (
      <p className="text-sm text-muted-foreground">No schematic or PCB snapshot is available for this revision.</p>
    );
  } else {
    canvasContent = (
      <ReviewCanvas
        headSnapshots={review.headSnapshots}
        {...(review.baseSnapshots ? { baseSnapshots: review.baseSnapshots } : {})}
      />
    );
  }

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
                {pcb.status}
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
                    {change.changeType}
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
      <Panel
        title="Schematic & PCB Canvas"
        description="Rendered from this revision's actual findings and changed sheets/layers. Pan, zoom, and open a finding marker for detail."
        tone="raised"
      >
        {canvasContent}
      </Panel>

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
  );
}
