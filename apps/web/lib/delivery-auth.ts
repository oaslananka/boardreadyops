import { createHash } from "node:crypto";
import type { DeliveryRecord, SqlQueryExecutor } from "@boardreadyops/db";

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
  signed_archive_url: string;
  recipient_notes: string | null;
  created_at: string | Date;
};

export async function verifyDeliveryToken(rawToken: string, executor: SqlQueryExecutor): Promise<DeliveryAuthResult> {
  if (!rawToken || typeof rawToken !== "string" || rawToken.trim() === "") {
    return { ok: false, status: 400, error: "Missing delivery token" };
  }

  const tokenHash = createHash("sha256").update(rawToken.trim()).digest("hex");
  const result = (await executor.query(
    `select id, revision_id, access_token_hash, expires_at, signed_archive_url, recipient_notes, created_at
     from deliveries
     where access_token_hash = $1`,
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

  return {
    ok: true,
    status: 200,
    delivery: {
      id: row.id,
      revisionId: row.revision_id,
      accessTokenHash: row.access_token_hash,
      expiresAt: new Date(row.expires_at).toISOString(),
      signedArchiveUrl: row.signed_archive_url,
      ...(row.recipient_notes !== null ? { recipientNotes: row.recipient_notes } : {}),
      createdAt: new Date(row.created_at).toISOString(),
    },
  };
}
