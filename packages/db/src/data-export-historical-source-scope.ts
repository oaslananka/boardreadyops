import { createHash } from "node:crypto";
import {
  assessHistoricalUserHardwareOwnedRowCounts,
  historicalUserHardwareSourceNames,
} from "./data-export-historical-hardware-owner-counts.js";
import { prepareVerifiedHistoricalUserMutationEpochSha256 } from "./data-export-historical-inventory.js";
import { assessHistoricalUserSchemaCoverage } from "./data-export-historical-schema-coverage.js";
import type { PgQueryExecutor } from "./pg-executor.js";

/**
 * INTERNAL source-only diagnostic. The catalog, 19 private source-count
 * classes and existing partly-covered mutation epochs are observed inside
 * ONE read-only repeatable-read transaction.
 * This does not prove third-party rights, include physical object bytes,
 * guarantee complete legacy rows, or create a customer-export capability.
 */
export type HistoricalUserSourceScopeObservation = {
  status: "known-relational-source-scope-unapproved";
  releaseDecision: "NO_GO";
  completeCustomerExport: false;
  customerDeliveryAllowed: false;
  sourceRightsVerified: false;
  thirdPartyDisclosureRightsVerified: false;
  tableCount: 92;
  sourceClassCount: 19;
  scopeFingerprintSha256: string;
};

const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/u;
const sha256 = /^[0-9a-f]{64}$/u;
const scopeDomain = Buffer.from("boardreadyops:historical-user:internal-relational-scope:v3\0", "utf8");

export async function assessHistoricalUserSourceScope(
  db: Pick<PgQueryExecutor, "withTransaction">,
  input: { exportId: string; verifiedGitHubUserId: number },
): Promise<HistoricalUserSourceScopeObservation | null> {
  if (
    !db?.withTransaction ||
    !uuid.test(input?.exportId) ||
    !Number.isSafeInteger(input?.verifiedGitHubUserId) ||
    input.verifiedGitHubUserId <= 0
  )
    return null;

  // Freeze immutable identity BEFORE any asynchronous catalog or source read.
  const originalUser = { exportId: input.exportId, verifiedGitHubUserId: input.verifiedGitHubUserId };
  try {
    return await db.withTransaction(
      async (transaction) => {
        // Both existing guards normally own their own transactions.
        // Route their callbacks to the ONE outer repeatable-read connection,
        // while verifying they still request the canonical read-only contract.
        const sharedSnapshot = {
          async withTransaction<T>(
            work: (connection: typeof transaction) => Promise<T>,
            options?: { consistentRead?: true; statementTimeoutMs?: number },
          ): Promise<T> {
            if (options?.consistentRead !== true || options.statementTimeoutMs !== 5000)
              throw new Error("Historical scope guard must use the pinned read-only transaction");
            return await work(transaction);
          },
        };
        const schema = await assessHistoricalUserSchemaCoverage(sharedSnapshot);
        if (
          schema.status !== "known_schema_scope_unapproved" ||
          schema.tableCount !== 92 ||
          !schema.schemaSha256 ||
          !sha256.test(schema.schemaSha256)
        )
          return null;

        const counts = await assessHistoricalUserHardwareOwnedRowCounts(sharedSnapshot, originalUser);
        if (
          counts?.scope !== "original-numeric-user-retained-suspended-installation-only" ||
          counts.releaseDecision !== "NO_GO" ||
          counts.completeCustomerExport !== false ||
          counts.customerDeliveryAllowed !== false ||
          counts.sourceRightsVerified !== false ||
          counts.thirdPartyDisclosureRightsVerified !== false
        )
          return null;
        const ordered = Object.entries(counts.rowCounts).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        );
        if (
          ordered.length !== historicalUserHardwareSourceNames.length ||
          ordered.length !== 19 ||
          ordered.some(
            ([key, count]) =>
              !historicalUserHardwareSourceNames.includes(key as (typeof historicalUserHardwareSourceNames)[number]) ||
              typeof count !== "number" ||
              !Number.isSafeInteger(count) ||
              count < 0 ||
              count > 100,
          )
        )
          return null;

        // All 19 owner-joined hardware multiset digests are SHA256-hashed
        // entirely inside PostgreSQL, never materializing raw IP/BOM rows
        // in the application. Count-preserving hardware edits change scope.
        // Still bind existing mutation epochs for tracked ABA activity
        // (even if the rows are subsequently restored byte-identically).
        const orderedDigests = Object.entries(counts.rowDigests).sort(([left], [right]) =>
          left < right ? -1 : left > right ? 1 : 0,
        );
        if (
          orderedDigests.length !== historicalUserHardwareSourceNames.length ||
          orderedDigests.length !== 19 ||
          orderedDigests.some(
            ([name, digest]) =>
              !historicalUserHardwareSourceNames.includes(name as (typeof historicalUserHardwareSourceNames)[number]) ||
              typeof digest !== "string" ||
              !sha256.test(digest),
          )
        )
          return null;
        const mutationEpochSha256 = await prepareVerifiedHistoricalUserMutationEpochSha256(transaction, originalUser);
        if (!sha256.test(mutationEpochSha256)) return null;
        const message = Buffer.from(
          JSON.stringify([
            originalUser.exportId,
            originalUser.verifiedGitHubUserId,
            schema.schemaSha256,
            ordered,
            orderedDigests,
            mutationEpochSha256,
          ]),
          "utf8",
        );
        try {
          const scopeFingerprintSha256 = createHash("sha256").update(scopeDomain).update(message).digest("hex");
          return {
            status: "known-relational-source-scope-unapproved",
            releaseDecision: "NO_GO",
            completeCustomerExport: false,
            customerDeliveryAllowed: false,
            sourceRightsVerified: false,
            thirdPartyDisclosureRightsVerified: false,
            tableCount: 92,
            sourceClassCount: 19,
            scopeFingerprintSha256,
          };
        } finally {
          message.fill(0);
        }
      },
      { consistentRead: true, statementTimeoutMs: 5000 },
    );
  } catch {
    return null;
  }
}
