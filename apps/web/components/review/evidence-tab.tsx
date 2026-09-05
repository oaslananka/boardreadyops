import type { DemoReview } from "../../lib/demo-data.js";
import { CopyButton } from "../copy-button.js";
import { Panel } from "../ui.js";

export function EvidenceTab({ review }: { review: DemoReview }) {
  return (
    <div className="flex flex-col gap-5">
      <Panel
        title="Evidence Pack Manifest"
        description="SHA-256 artifact digests and revision-bound evidence records for this hardware revision."
        tone="raised"
      >
        <div className="flex items-center justify-between gap-3 rounded-md bg-muted p-3">
          <div>
            <span className="text-xs uppercase text-muted-foreground">Head Evidence Digest (SHA-256):</span>
            <code className="ml-2 break-all text-sm">{review.evidenceDigest}</code>
          </div>
          <CopyButton value={review.evidenceDigest} label="Copy SHA-256 Digest" />
        </div>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-border text-xs uppercase text-muted-foreground">
                <th className="py-2 pr-3">Artifact Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Repository Path</th>
                <th className="py-2 pr-3">SHA-256 Hash</th>
                <th className="py-2 pr-3">Size</th>
              </tr>
            </thead>
            <tbody>
              {review.evidenceItems.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-center text-muted-foreground">
                    No artifacts stored in metadata-only mode.
                  </td>
                </tr>
              ) : (
                review.evidenceItems.map((item) => (
                  <tr key={item.name} className="border-b border-border last:border-b-0">
                    <td className="py-2 pr-3 font-medium text-foreground">{item.name}</td>
                    <td className="py-2 pr-3">
                      <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs uppercase text-muted-foreground">
                        {item.type}
                      </span>
                    </td>
                    <td className="py-2 pr-3">
                      <code>{item.path}</code>
                    </td>
                    <td className="py-2 pr-3">
                      <code title={item.sha256}>{item.sha256.slice(0, 16)}...</code>
                    </td>
                    <td className="py-2 pr-3">{(item.sizeBytes / 1024).toFixed(1)} KB</td>
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
        <div className="rounded-md bg-muted p-3">
          <div className="flex items-center justify-between text-xs uppercase text-muted-foreground">
            <span>Terminal Command</span>
            <CopyButton
              value={`boardreadyops review verify --digest ${review.evidenceDigest} --repo ${review.repositoryName}`}
              label="Copy Command"
            />
          </div>
          <pre className="mt-2 overflow-x-auto text-sm">
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
