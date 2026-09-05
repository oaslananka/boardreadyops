import type { ReactNode } from "react";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";

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

function verdictBadgeVariant(isVerified: boolean, isPass: boolean): "secondary" | "success" | "danger" {
  if (!isVerified) return "secondary";
  return isPass ? "success" : "danger";
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

  return (
    <div className="delivery-signoff-card flex flex-col gap-5 rounded-md border border-border bg-card p-5 shadow-lg">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="text-xs uppercase text-muted-foreground">
            {isVerified ? "Verified Manufacturing Package" : "Unverified Package"}
          </span>
          <h2 className="text-xl font-bold text-foreground">Revision {revisionId}</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={verdictBadgeVariant(isVerified, isPass)}>
            {isVerified ? readinessVerdict.toUpperCase() : "UNVERIFIED"}
          </Badge>
          {readinessScore !== undefined && (
            <span className="rounded-sm bg-muted px-1.5 py-0.5 text-xs text-muted-foreground">
              {readinessScore}/100
            </span>
          )}
        </div>
      </div>

      {recipientNotes && (
        <div className="rounded-md bg-muted p-3 text-sm">
          <strong className="font-medium text-foreground">Notes from Engineering:</strong>
          <p className="mt-1 text-muted-foreground">{recipientNotes}</p>
        </div>
      )}

      <div className="rounded-md bg-muted p-3">
        <span className="text-xs uppercase text-muted-foreground">Cryptographic Archive Digest (SHA-256)</span>
        <code className="mt-1 block break-all text-sm">{bundleSha256 || "Pending verification"}</code>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <span className="block text-xs uppercase text-muted-foreground">Sign-Off Status</span>
          <span className="text-sm text-foreground">{signOffStatus(signedBy, isVerified)}</span>
          {signedAt && <span className="block text-xs text-muted-foreground">{new Date(signedAt).toUTCString()}</span>}
        </div>

        <div>
          <span className="block text-xs uppercase text-muted-foreground">Waiver Dispositions</span>
          <span className="text-sm text-foreground">{waiverDisposition(waiverCount)}</span>
        </div>

        <div>
          <span className="block text-xs uppercase text-muted-foreground">Package Expiration</span>
          <span className="text-sm text-foreground">{new Date(expiresAt).toUTCString()}</span>
        </div>
      </div>

      <Button asChild>
        <a className="download-bundle-button" href={signedArchiveUrl} download rel="noopener noreferrer">
          {isVerified ? "Download Sealed Package (.zip)" : "Download Package (.zip)"}
        </a>
      </Button>

      {children}
    </div>
  );
}
