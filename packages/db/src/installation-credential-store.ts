import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

/**
 * Storage for the component-intelligence credentials an installation supplies.
 *
 * This layer never decrypts. It moves an opaque envelope in and out of the database, so the
 * key stays in whichever process is entitled to use it and a bug here cannot turn into a
 * plaintext credential in a log line or an error message.
 */

export type StoredCredential = {
  installationId: string;
  provider: string;
  envelope: string;
  rejectedAt: string | undefined;
  rejectedReason: string | undefined;
};

export type InstallationCredentialStore = {
  /** The stored envelope for one installation and provider, if any. */
  find(installationId: string, provider: string): Promise<StoredCredential | undefined>;
  /** Replaces the credential, clearing any recorded rejection because the secret changed. */
  put(installationId: string, provider: string, envelope: string): Promise<void>;
  remove(installationId: string, provider: string): Promise<boolean>;
  /** Records that the provider refused this credential, without discarding it. */
  markRejected(installationId: string, provider: string, reason: string, at: Date): Promise<void>;
  /** Clears a recorded rejection after a lookup succeeds again. */
  clearRejection(installationId: string, provider: string): Promise<void>;
};

const maximumReasonLength = 200;

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function text(row: Record<string, unknown> | undefined, name: string): string | undefined {
  const value = row?.[name];
  if (typeof value === "string") return value;
  if (value instanceof Date) return value.toISOString();
  return undefined;
}

export function createSqlInstallationCredentialStore(executor: SqlQueryExecutor): InstallationCredentialStore {
  return {
    async find(installationId, provider) {
      const result = await executor.query(
        `select installation_id, provider, credential_envelope, last_rejected_at, last_rejected_reason
           from installation_component_credentials
          where installation_id = $1 and provider = $2`,
        [installationId, provider],
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      return {
        installationId: text(row, "installation_id") ?? installationId,
        provider: text(row, "provider") ?? provider,
        envelope: text(row, "credential_envelope") ?? "",
        rejectedAt: text(row, "last_rejected_at"),
        rejectedReason: text(row, "last_rejected_reason"),
      };
    },

    async put(installationId, provider, envelope) {
      await executor.query(
        `insert into installation_component_credentials (installation_id, provider, credential_envelope)
         values ($1, $2, $3)
         on conflict (installation_id, provider) do update
           set credential_envelope = excluded.credential_envelope,
               updated_at = now(),
               -- A replaced secret is a new secret: keeping the old rejection would report a
               -- credential problem the customer has just fixed.
               last_rejected_at = null,
               last_rejected_reason = null`,
        [installationId, provider, envelope],
      );
    },

    async remove(installationId, provider) {
      const result = await executor.query(
        `delete from installation_component_credentials
          where installation_id = $1 and provider = $2
          returning installation_id`,
        [installationId, provider],
      );
      return rows(result).length > 0;
    },

    async markRejected(installationId, provider, reason, at) {
      // The credential is kept rather than deleted. A provider outage and a revoked key look
      // the same from here, and discarding a still-valid secret would make the customer
      // re-enter it for what may have been a transient failure.
      await executor.query(
        `update installation_component_credentials
            set last_rejected_at = $3::timestamptz,
                last_rejected_reason = $4
          where installation_id = $1 and provider = $2`,
        [installationId, provider, at.toISOString(), reason.slice(0, maximumReasonLength)],
      );
    },

    async clearRejection(installationId, provider) {
      await executor.query(
        `update installation_component_credentials
            set last_rejected_at = null, last_rejected_reason = null
          where installation_id = $1 and provider = $2 and last_rejected_at is not null`,
        [installationId, provider],
      );
    },
  };
}
