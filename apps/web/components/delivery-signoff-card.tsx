import type { ReactNode } from "react";

export type DeliverySignoffCardProps = Readonly<{
  revisionId: string;
  bundleSha256?: string | undefined;
  readinessVerdict?: "pass" | "fail" | "warning" | undefined;
  readinessScore?: number | undefined;
  waiverCount?: number | undefined;
  signedArchiveUrl: string;
  signedBy?: string | undefined;
  signedAt?: string | undefined;
  recipientNotes?: string | undefined;
  expiresAt: string;
  children?: ReactNode | undefined;
}>;

export function DeliverySignoffCard({
  revisionId,
  bundleSha256,
  readinessVerdict,
  readinessScore,
  waiverCount,
  signedArchiveUrl,
  signedBy,
  signedAt,
  recipientNotes,
  expiresAt,
  children,
}: DeliverySignoffCardProps) {
  const isVerified = readinessVerdict !== undefined;
  const isPass = readinessVerdict === "pass";
  let verdictClass = "verdict-unverified";
  if (isVerified) {
    verdictClass = isPass ? "verdict-pass" : "verdict-fail";
  }

  return (
    <div className="delivery-signoff-card">
      <div className="delivery-card-header">
        <div className="delivery-title-block">
          <span className="delivery-badge">{isVerified ? "Verified Manufacturing Package" : "Unverified Package"}</span>
          <h2>Revision {revisionId}</h2>
        </div>
        <div className="delivery-verdict-block">
          <span className={`verdict-pill ${verdictClass}`}>
            {isVerified ? readinessVerdict.toUpperCase() : "UNVERIFIED"}
          </span>
          {readinessScore !== undefined && <span className="score-badge">{readinessScore}/100</span>}
        </div>
      </div>

      {recipientNotes && (
        <div className="delivery-notes-box">
          <strong>Notes from Engineering:</strong>
          <p>{recipientNotes}</p>
        </div>
      )}

      <div className="delivery-crypto-manifest">
        <div className="crypto-item">
          <span className="crypto-label">Cryptographic Archive Digest (SHA-256)</span>
          <code className="crypto-hash">{bundleSha256 || "Pending verification"}</code>
        </div>
      </div>

      <div className="delivery-meta-grid">
        <div className="meta-card">
          <span className="meta-label">Sign-Off Status</span>
          <span className="meta-value">{signOffStatus(signedBy, isVerified)}</span>
          {signedAt && <span className="meta-date">{new Date(signedAt).toUTCString()}</span>}
        </div>

        <div className="meta-card">
          <span className="meta-label">Waiver Dispositions</span>
          <span className="meta-value">{waiverDisposition(waiverCount)}</span>
        </div>

        <div className="meta-card">
          <span className="meta-label">Package Expiration</span>
          <span className="meta-value">{new Date(expiresAt).toUTCString()}</span>
        </div>
      </div>

      <div className="delivery-actions-band">
        <a
          className="download-bundle-button button button-primary"
          href={signedArchiveUrl}
          download
          rel="noopener noreferrer"
        >
          {isVerified ? "Download Sealed Package (.zip)" : "Download Package (.zip)"}
        </a>
      </div>

      {children}
    </div>
  );
}

function signOffStatus(signedBy: string | undefined, isVerified: boolean): string {
  if (signedBy) return `Signed by ${signedBy}`;
  return isVerified ? "Engineering Auto-Verified" : "Sign-off not recorded";
}

function waiverDisposition(waiverCount: number | undefined): string {
  if (waiverCount === undefined) return "Waivers not evaluated";
  if (waiverCount === 0) return "Zero active waivers";
  return `${waiverCount} active waiver${waiverCount === 1 ? "" : "s"}`;
}
