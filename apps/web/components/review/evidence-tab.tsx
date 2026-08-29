import type { DemoReview } from "../../lib/demo-data.js";
import { CopyButton } from "../copy-button.js";
import { Panel } from "../ui.js";

export function EvidenceTab({ review }: { review: DemoReview }) {
  return (
    <div className="provenance-chain evidence-tab-content">
      <Panel
        title="Evidence Pack Manifest"
        description="SHA-256 artifact digests and revision-bound evidence records for this hardware revision."
        tone="raised"
      >
        <div className="evidence-digest-summary-box panel surface-inset">
          <div className="summary-left">
            <span className="summary-title">Head Evidence Digest (SHA-256):</span>
            <code className="summary-digest">{review.evidenceDigest}</code>
          </div>
          <div className="summary-right">
            <CopyButton value={review.evidenceDigest} label="Copy SHA-256 Digest" />
          </div>
        </div>

        <div className="evidence-table-wrap">
          <table className="evidence-table">
            <thead>
              <tr>
                <th>Artifact Name</th>
                <th>Type</th>
                <th>Repository Path</th>
                <th>SHA-256 Hash</th>
                <th>Size</th>
              </tr>
            </thead>
            <tbody>
              {review.evidenceItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-muted">
                    No artifacts stored in metadata-only mode.
                  </td>
                </tr>
              ) : (
                review.evidenceItems.map((item) => (
                  <tr key={item.name}>
                    <td>
                      <strong>{item.name}</strong>
                    </td>
                    <td>
                      <span className={`artifact-type-pill ${item.type}`}>{item.type}</span>
                    </td>
                    <td>
                      <code>{item.path}</code>
                    </td>
                    <td>
                      <code className="digest-code-short" title={item.sha256}>
                        {item.sha256.slice(0, 16)}...
                      </code>
                    </td>
                    <td>{(item.sizeBytes / 1024).toFixed(1)} KB</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Panel>

      <Panel
        title="Offline Verification & Governance"
        description="Verify this hardware evidence package offline using the BoardReadyOps CLI."
        tone="default"
      >
        <div className="cli-verify-code-block panel surface-inset">
          <div className="code-block-header">
            <span>Terminal Command</span>
            <CopyButton
              value={`boardreadyops review verify --digest ${review.evidenceDigest} --repo ${review.repositoryName}`}
              label="Copy Command"
            />
          </div>
          <pre className="code-content">
            <code>
              {`# Run local deterministic verification of evidence pack
boardreadyops review verify \\
  --digest ${review.evidenceDigest} \\
  --repo ${review.repositoryName} \\
  --head ${review.headCommitSha}`}
            </code>
          </pre>
        </div>
      </Panel>
    </div>
  );
}
