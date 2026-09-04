import type { DemoReview } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";
import { ReviewCanvas } from "./review-canvas.js";

export function ChangesTab({ review }: { readonly review: DemoReview }) {
  const pcbs = review.changedFiles?.filter((f) => f.path.endsWith(".kicad_pcb")) ?? [];

  let canvasContent: React.ReactNode;
  if (!review.headSnapshots || review.headSnapshots.length === 0) {
    canvasContent = <p className="empty-notice">No schematic or PCB snapshot is available for this revision.</p>;
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
      <p className="empty-notice">PCB surface change details are not available for this persisted review.</p>
    );
  } else if (pcbs.length === 0) {
    pcbContent = <p className="empty-notice">No PCB files modified in this revision.</p>;
  } else {
    pcbContent = (
      <div className="pcb-diff-grid">
        {pcbs.map((pcb) => (
          <div key={pcb.path} className="pcb-card panel surface-default">
            <div className="pcb-card-header">
              <h4>{pcb.path.split("/").pop()}</h4>
              <span className={`file-status-badge ${pcb.status}`}>{pcb.status}</span>
            </div>
            <p className="pcb-change-count">{pcb.changesCount} geometry/placement changes detected.</p>
          </div>
        ))}
      </div>
    );
  }

  let bomContent: React.ReactNode;
  if (review.bomChanges === undefined) {
    bomContent = (
      <p className="empty-notice">BOM component delta details are not available for this persisted review.</p>
    );
  } else if (review.bomChanges.length === 0) {
    bomContent = <p className="empty-notice">No BOM changes recorded for this revision.</p>;
  } else {
    bomContent = (
      <div className="bom-delta-table-wrap">
        <table className="bom-delta-table">
          <thead>
            <tr>
              <th>Component</th>
              <th>Change Type</th>
              <th>Base MPN</th>
              <th>Head MPN</th>
              <th>Manufacturer</th>
            </tr>
          </thead>
          <tbody>
            {review.bomChanges.map((change) => (
              <tr key={change.reference}>
                <td>
                  <code>{change.reference}</code>
                </td>
                <td>
                  <span className={`file-status-badge ${change.changeType}`}>{change.changeType}</span>
                </td>
                <td>{change.baseMpn ? <code>{change.baseMpn}</code> : "—"}</td>
                <td>
                  {change.headMpn ? <code>{change.headMpn}</code> : <span className="text-danger">Missing MPN</span>}
                </td>
                <td>{change.manufacturer ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="changes-tab-content">
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
