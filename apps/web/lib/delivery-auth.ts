import { createHash } from "node:crypto";
import { type DeliveryRecord, isHttpsDeliveryArchiveUrl, type SqlQueryExecutor } from "@boardreadyops/db";

export interface DeliveryAuthResult {
  ok: boolean;
  status: number;
  delivery?: DeliveryRecord | undefined;
  error?: string | undefined;
}

type DeliveryRow = {
  id: string;
  revision_id: string;
  access_token_hash: string;
  expires_at: string | Date;
  signed_archive_url: string | null;
  recipient_notes: string | null;
  created_at: string | Date;
  evidence_valid: boolean;
};

export async function verifyDeliveryToken(rawToken: string, executor: SqlQueryExecutor): Promise<DeliveryAuthResult> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim() === "") {
    return { ok: false, status: 400, error: "Missing delivery token" };
  }

  const tokenHash = createHash("sha256").update(rawToken.trim()).digest("hex");
  const result = (await executor.query(
    `select deliveries.id, deliveries.revision_id, deliveries.access_token_hash, deliveries.expires_at,
            deliveries.signed_archive_url, deliveries.recipient_notes, deliveries.created_at,
            exists (
              select 1 from revisions
              join release_runs on release_runs.id = revisions.validation_run_id
                and release_runs.status = 'completed'
                and release_runs.decision = 'pass'
                and release_runs.completed_at is not null
              join artifacts on artifacts.id = revisions.validation_artifact_id
                and artifacts.run_id = release_runs.id
                and artifacts.role = 'manufacturing'
                and artifacts.kind = 'archive'
                and artifacts.bytes > 0
                and artifacts.sha256 ~ '^[0-9a-f]{64}$'
              join manufacturing_share_authorizations as share
                on share.revision_id = revisions.id
                and share.revoked_at is null
                and share.run_id = release_runs.id
                and share.artifact_id = artifacts.id
                and share.commit_sha = release_runs.commit_sha
                and share.archive_sha256 = artifacts.sha256
              where revisions.id = deliveries.revision_id
                and revisions.bundle_sha256 = artifacts.sha256
                and revisions.commit_sha = release_runs.commit_sha
            ) as evidence_valid
       from deliveries
      where deliveries.access_token_hash = $1`,
    [tokenHash],
  )) as { rows?: DeliveryRow[] };

  const row = result?.rows?.[0];
  if (!row) {
    return { ok: false, status: 404, error: "Delivery not found or invalid token" };
  }

  const expiresAt = new Date(row.expires_at).getTime();
  if (expiresAt <= Date.now()) {
    return { ok: false, status: 410, error: "Delivery token has expired" };
  }

  // A guest token can outlive its originating run. Never disclose an archive URL after the
  // manufacturing evidence loses the passing verdict, artifact, digest or commit binding.
  if (
    row.evidence_valid !== true ||
    (row.signed_archive_url !== null && !isHttpsDeliveryArchiveUrl(row.signed_archive_url))
  ) {
    return { ok: false, status: 404, error: "Delivery manufacturing evidence or archive URL is no longer valid" };
  }

  return {
    ok: true,
    status: 200,
    delivery: {
      id: row.id,
      revisionId: row.revision_id,
      accessTokenHash: row.access_token_hash,
      expiresAt: new Date(row.expires_at).toISOString(),
      ...(row.signed_archive_url !== null ? { signedArchiveUrl: row.signed_archive_url } : {}),
      ...(row.recipient_notes !== null ? { recipientNotes: row.recipient_notes } : {}),
      createdAt: new Date(row.created_at).toISOString(),
    },
  };
}
