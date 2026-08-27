import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { ExternalReviewInvitation, ExternalReviewScope } from "@boardreadyops/contracts";
import type { SqlQueryExecutor } from "./lifecycle-store.js";

export type StoredExternalReviewInvitationRow = {
  id: string;
  tenant_id: string;
  review_id: string;
  recipient_email: string;
  recipient_name: string;
  scope: ExternalReviewScope;
  token_hash: string;
  expires_at: string | Date;
  revoked_at: string | Date | null;
  created_by_id: string;
  created_at: string | Date;
};

export function hashExternalReviewToken(rawToken: string): string {
  return createHash("sha256").update(rawToken).digest("hex");
}

export function generateExternalReviewToken(): { rawToken: string; tokenHash: string } {
  const rawToken = `bro_ext_${randomBytes(24).toString("hex")}`;
  const tokenHash = hashExternalReviewToken(rawToken);
  return { rawToken, tokenHash };
}

function mapInvitation(row: StoredExternalReviewInvitationRow): ExternalReviewInvitation {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    reviewId: row.review_id,
    recipientEmail: row.recipient_email,
    recipientName: row.recipient_name,
    scope: row.scope,
    tokenHash: row.token_hash,
    expiresAt: typeof row.expires_at === "string" ? row.expires_at : row.expires_at.toISOString(),
    revokedAt: row.revoked_at
      ? typeof row.revoked_at === "string"
        ? row.revoked_at
        : row.revoked_at.toISOString()
      : null,
    createdById: row.created_by_id,
    createdAt: typeof row.created_at === "string" ? row.created_at : row.created_at.toISOString(),
  };
}

export class ExternalReviewStore {
  constructor(private readonly db: SqlQueryExecutor) {}

  async createInvitation(input: {
    tenantId: string;
    reviewId: string;
    recipientEmail: string;
    recipientName: string;
    scope: ExternalReviewScope;
    expiresInDays?: number;
    createdById: string;
  }): Promise<{ invitation: ExternalReviewInvitation; rawToken: string }> {
    const id = randomUUID();
    const { rawToken, tokenHash } = generateExternalReviewToken();
    const days = input.expiresInDays && input.expiresInDays > 0 ? input.expiresInDays : 14;
    const expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();

    const query = `
      INSERT INTO external_review_invitations (
        id, tenant_id, review_id, recipient_email, recipient_name,
        scope, token_hash, expires_at, created_by_id, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
      RETURNING *
    `;

    const queryResult = (await this.db.query(query, [
      id,
      input.tenantId,
      input.reviewId,
      input.recipientEmail.toLowerCase().trim(),
      input.recipientName.trim(),
      input.scope,
      tokenHash,
      expiresAt,
      input.createdById,
    ])) as { rows?: StoredExternalReviewInvitationRow[] };

    const row = queryResult.rows?.[0];
    if (!row) {
      throw new Error("Failed to insert external review invitation");
    }

    return {
      invitation: mapInvitation(row),
      rawToken,
    };
  }

  async getInvitationByToken(rawToken: string): Promise<ExternalReviewInvitation | null> {
    const tokenHash = hashExternalReviewToken(rawToken);
    const query = `
      SELECT * FROM external_review_invitations
      WHERE token_hash = $1
      LIMIT 1
    `;

    const queryResult = (await this.db.query(query, [tokenHash])) as {
      rows?: StoredExternalReviewInvitationRow[];
    };
    const row = queryResult.rows?.[0];
    if (!row) return null;

    const inv = mapInvitation(row);
    // Check if revoked or expired
    if (inv.revokedAt) return null;
    if (new Date(inv.expiresAt).getTime() < Date.now()) return null;

    return inv;
  }

  async listInvitationsForReview(tenantId: string, reviewId: string): Promise<ExternalReviewInvitation[]> {
    const query = `
      SELECT * FROM external_review_invitations
      WHERE tenant_id = $1 AND review_id = $2
      ORDER BY created_at DESC
    `;

    const queryResult = (await this.db.query(query, [tenantId, reviewId])) as {
      rows?: StoredExternalReviewInvitationRow[];
    };
    return (queryResult.rows ?? []).map(mapInvitation);
  }

  async revokeInvitation(tenantId: string, invitationId: string): Promise<boolean> {
    const query = `
      UPDATE external_review_invitations
      SET revoked_at = NOW()
      WHERE id = $1 AND tenant_id = $2 AND revoked_at IS NULL
    `;

    const queryResult = (await this.db.query(query, [invitationId, tenantId])) as {
      rowCount?: number;
    };
    return (queryResult.rowCount ?? 0) > 0;
  }
}
