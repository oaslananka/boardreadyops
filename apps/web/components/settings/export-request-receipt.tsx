"use client";

import { useState } from "react";
import { customerStatusLabel } from "../../lib/customer-nomenclature.js";
import { AlertDescription, AlertRoot, AlertTitle } from "../ui/alert.js";
import { Button } from "../ui/button.js";

type ExportReceipt = Readonly<{ exportId: string; status: string }>;

function statusUrl(exportId: string, installationId: string): string {
  return `/api/v1/data-exports/${encodeURIComponent(exportId)}?installationId=${encodeURIComponent(installationId)}`;
}

/**
 * A post-request receipt, not an export worker.
 * All three controls rely on the same server-side session, installation and
 * original-requester authorization; client state grants no access by itself.
 */
export function ExportRequestReceipt({
  issued,
  installationId,
}: Readonly<{ issued: ExportReceipt; installationId: string }>) {
  const [status, setStatus] = useState(issued.status);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [revoked, setRevoked] = useState(false);
  const url = statusUrl(issued.exportId, installationId);

  async function refreshStatus(): Promise<void> {
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch(url, { cache: "no-store", credentials: "same-origin" });
      if (!response.ok) {
        setFeedback("Could not access this request. Check your installation access and try again.");
        return;
      }
      const result: unknown = await response.json();
      if (
        typeof result !== "object" ||
        result === null ||
        !("export" in result) ||
        typeof result.export !== "object" ||
        result.export === null ||
        !("status" in result.export) ||
        typeof result.export.status !== "string"
      ) {
        setFeedback("The request status response was incomplete.");
        return;
      }
      setStatus(result.export.status);
      setFeedback("Request status refreshed. This is not confirmation of a completed customer export.");
    } catch {
      setFeedback("Unable to refresh status. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function downloadMetadata(): Promise<void> {
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch(`${url}&download=metadata-manifest`, {
        cache: "no-store",
        credentials: "same-origin",
      });
      if (response.status === 404) {
        setFeedback("Metadata preview is not published, has expired, or has been revoked.");
        return;
      }
      if (!response.ok) {
        setFeedback("Metadata preview is unavailable for your current account or installation.");
        return;
      }
      if (!response.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
        setFeedback("The server did not return a metadata JSON preview. Nothing was downloaded.");
        return;
      }
      const blob = await response.blob();
      if (blob.size === 0 || blob.size > 65536) {
        setFeedback("Metadata preview size was invalid. Nothing was downloaded.");
        return;
      }
      const objectUrl = URL.createObjectURL(blob);
      try {
        const link = document.createElement("a");
        link.href = objectUrl;
        link.download = `boardreadyops-metadata-${issued.exportId}.json`;
        link.style.display = "none";
        document.body.append(link);
        link.click();
        link.remove();
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
      setFeedback("Metadata-only preview downloaded. This is not your full customer data archive.");
    } catch {
      setFeedback("Unable to download the metadata preview. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  async function revokeMetadata(): Promise<void> {
    if (!window.confirm("Revoke access to this metadata preview? This does not delete existing downloaded copies.")) {
      return;
    }
    setBusy(true);
    setFeedback("");
    try {
      const response = await fetch(url, {
        method: "DELETE",
        cache: "no-store",
        credentials: "same-origin",
      });
      if (!response.ok) {
        setFeedback("No active metadata preview could be revoked for this request.");
        return;
      }
      setRevoked(true);
      setFeedback("Metadata preview access revoked. Downloaded copies are not deleted.");
    } catch {
      setFeedback("Unable to revoke the metadata preview. Please try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AlertRoot variant="info">
      <AlertTitle>Export request {customerStatusLabel(status)}</AlertTitle>
      <AlertDescription>
        <p>
          Reference <code className="font-mono">{issued.exportId}</code>. An export request does not create a customer
          archive automatically. An authorized operator must prepare delivery separately.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={refreshStatus}>
            Refresh request status
          </Button>
          <Button type="button" size="sm" variant="secondary" disabled={busy || revoked} onClick={downloadMetadata}>
            Download metadata preview
          </Button>
          <Button type="button" size="sm" variant="outline" disabled={busy || revoked} onClick={revokeMetadata}>
            Revoke metadata preview
          </Button>
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          The preview, if an operator publishes it, contains limited repository metadata only. Access expires after 15
          minutes and can be revoked. A completed customer archive is not yet available.
        </p>
        {feedback ? (
          <p role="status" aria-live="polite" className="mt-2 text-sm">
            {feedback}
          </p>
        ) : null}
      </AlertDescription>
    </AlertRoot>
  );
}
