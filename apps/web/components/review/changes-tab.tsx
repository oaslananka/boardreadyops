import type { DemoReview } from "../../lib/demo-data.js";
import { Panel } from "../ui.js";

export function ChangesTab({ review }: { review: DemoReview }) {
  const schematics = review.changedFiles.filter((f) => f.path.endsWith(".kicad_sch"));
  const pcbs = review.changedFiles.filter((f) => f.path.endsWith(".kicad_pcb"));
  const boms = review.changedFiles.filter((f) => f.path.endsWith(".csv") || f.path.includes("bom"));

  return (
    <div className="changes-tab-content">
      <Panel title="Schematic Changes" description="Hierarchical sheets modified between base and head revisions.">
        {schematics.length === 0 ? (
          <p className="empty-notice">No schematic sheets modified in this revision.</p>
        ) : (
          <div className="sheet-diff-grid">
            {schematics.map((sch) => (
              <div key={sch.path} className="sheet-card panel">
                <div className="sheet-card-header">
                  <h4>{sch.path.split("/").pop()}</h4>
                  <span className={`file-status-badge ${sch.status}`}>{sch.status}</span>
                </div>
                <div className="sheet-diff-preview">
                  <div className="schematic-mock-canvas">
                    <svg viewBox="0 0 400 200" className="sch-svg" role="img" aria-label="Schematic Diff Preview">
                      <rect
                        width="400"
                        height="200"
                        fill="var(--color-background-raised)"
                        stroke="var(--color-border-subtle)"
                      />
                      <path
                        d="M 50 100 L 150 100 L 150 50 L 250 50"
                        stroke="var(--color-border-strong)"
                        strokeWidth="2"
                        fill="none"
                      />
                      <circle cx="150" cy="100" r="4" fill="var(--color-primary)" />
                      <rect
                        x="250"
                        y="30"
                        width="80"
                        height="60"
                        rx="4"
                        fill="var(--color-background-sunken)"
                        stroke="var(--color-primary)"
                        strokeWidth="2"
                      />
                      <text
                        x="290"
                        y="65"
                        textAnchor="middle"
                        fill="var(--color-foreground-strong)"
                        fontSize="12"
                        fontFamily="var(--font-mono)"
                      >
                        U12 ISO
                      </text>
                      <text
                        x="20"
                        y="185"
                        fill="var(--color-foreground-muted)"
                        fontSize="10"
                        fontFamily="var(--font-mono)"
                      >
                        Sheet Diff: +{sch.changesCount} symbols/nets modified
                      </text>
                    </svg>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="PCB Layout & Stackup Changes"
        description="Copper traces, via placements, and keepout boundary modifications."
      >
        {pcbs.length === 0 ? (
          <p className="empty-notice">No PCB files modified.</p>
        ) : (
          <div className="pcb-diff-grid">
            {pcbs.map((pcb) => (
              <div key={pcb.path} className="pcb-card panel">
                <div className="pcb-card-header">
                  <h4>{pcb.path.split("/").pop()}</h4>
                  <span className={`file-status-badge ${pcb.status}`}>{pcb.status}</span>
                </div>
                <div className="pcb-layer-stats">
                  <span className="layer-pill fcu">F.Cu (Top)</span>
                  <span className="layer-pill in1">In1.Cu (GND)</span>
                  <span className="layer-pill in2">In2.Cu (PWR)</span>
                  <span className="layer-pill bcu">B.Cu (Bottom)</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel title="Bill of Materials (BOM) Delta">
        {boms.length === 0 ? (
          <p className="empty-notice">No BOM files changed.</p>
        ) : (
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
                <tr>
                  <td>
                    <code>U12</code>
                  </td>
                  <td>
                    <span className="file-status-badge added">Added</span>
                  </td>
                  <td>—</td>
                  <td>
                    <code>ISO1042BDWR</code>
                  </td>
                  <td>Texas Instruments</td>
                </tr>
                <tr>
                  <td>
                    <code>U1</code>
                  </td>
                  <td>
                    <span className="file-status-badge modified">Replaced</span>
                  </td>
                  <td>
                    <code>BQ24195RGER</code>
                  </td>
                  <td>
                    <code>MP2617GL-Z</code>
                  </td>
                  <td>Monolithic Power Systems</td>
                </tr>
                <tr>
                  <td>
                    <code>C12</code>
                  </td>
                  <td>
                    <span className="file-status-badge modified">Modified</span>
                  </td>
                  <td>
                    <code>GRM31CR71H106KA12L</code>
                  </td>
                  <td>
                    <span className="text-danger">Missing MPN</span>
                  </td>
                  <td>Murata</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
