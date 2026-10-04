import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type SupplyFindingAcknowledgementOutcome = "acknowledged" | "already_acknowledged" | "not_found";
export type SupplyFindingSuppressionOutcome = "suppressed" | "already_suppressed" | "not_found";
export type SupplyFindingClearSuppressionOutcome = "cleared" | "not_suppressed" | "not_found";

export type SupplyFindingStore = {
  /**
   * Acknowledges one currently-open finding inside the named repository.
   *
   * The repository predicate is part of the write itself so a guessed finding id can never mutate
   * another repository. Repeating the operation is idempotent and preserves the first actor/time.
   */
  acknowledge(
    repositoryId: string,
    findingId: string,
    actor: string,
    now: Date,
  ): Promise<SupplyFindingAcknowledgementOutcome>;
  /**
   * Creates one time-bound suppression for an open finding.
   *
   * Expired suppressions are closed first, so a new suppression can be added without deleting the
   * historical record. An active suppression is idempotent and is never silently overwritten.
   */
  suppress(
    repositoryId: string,
    findingId: string,
    actor: string,
    reason: string,
    expiresAt: Date,
    now: Date,
  ): Promise<SupplyFindingSuppressionOutcome>;
  /** Clears the current active suppression while retaining its audit row. */
  clearSuppression(
    repositoryId: string,
    findingId: string,
    actor: string,
    now: Date,
  ): Promise<SupplyFindingClearSuppressionOutcome>;
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function acknowledgementOutcome(value: unknown): SupplyFindingAcknowledgementOutcome {
  return value === "acknowledged" || value === "already_acknowledged" ? value : "not_found";
}

function suppressionOutcome(value: unknown): SupplyFindingSuppressionOutcome {
  return value === "suppressed" || value === "already_suppressed" ? value : "not_found";
}

function clearSuppressionOutcome(value: unknown): SupplyFindingClearSuppressionOutcome {
  return value === "cleared" || value === "not_suppressed" ? value : "not_found";
}

function boundedReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 3) throw new Error("reason must be at least 3 characters");
  if (normalized.length > 500) throw new Error("reason must be at most 500 characters");
  return normalized;
}

function requiredIdentifier(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

export function createSqlSupplyFindingStore(executor: SqlQueryExecutor): SupplyFindingStore {
  return {
    async acknowledge(repositoryId, findingId, actor, now) {
      const repository = requiredIdentifier(repositoryId, "repositoryId");
      const finding = requiredIdentifier(findingId, "findingId");
      const acknowledgedBy = requiredIdentifier(actor, "actor");
      if (acknowledgedBy.length > 128) throw new Error("actor must be at most 128 characters");

      const result = await executor.query(
        `with target as (
           select finding.id, finding.acknowledged_at
             from board_supply_findings as finding
             join boards on boards.id = finding.board_id
            where finding.id = $1
              and boards.repository_id = $2
              and finding.resolved_at is null
         ),
         updated as (
           update board_supply_findings as finding
              set acknowledged_at = $4::timestamptz,
                  acknowledged_by = $3
             from target
            where finding.id = target.id
              and target.acknowledged_at is null
           returning finding.id
         )
         select case
                  when exists (select 1 from updated) then 'acknowledged'
                  when exists (select 1 from target) then 'already_acknowledged'
                  else 'not_found'
                end as outcome`,
        [finding, repository, acknowledgedBy, now.toISOString()],
      );

      return acknowledgementOutcome(rows(result)[0]?.outcome);
    },

    async suppress(repositoryId, findingId, actor, reason, expiresAt, now) {
      const repository = requiredIdentifier(repositoryId, "repositoryId");
      const finding = requiredIdentifier(findingId, "findingId");
      const createdBy = requiredIdentifier(actor, "actor");
      if (createdBy.length > 128) throw new Error("actor must be at most 128 characters");
      const suppressionReason = boundedReason(reason);
      if (!(expiresAt instanceof Date) || Number.isNaN(expiresAt.valueOf()) || expiresAt <= now) {
        throw new Error("expiresAt must be after now");
      }

      const result = await executor.query(
        `with target as (
           select finding.id
             from board_supply_findings as finding
             join boards on boards.id = finding.board_id
            where finding.id = $1
              and boards.repository_id = $2
              and finding.resolved_at is null
         ),
         expired as (
           update supply_finding_suppressions as suppression
              set cleared_at = $6::timestamptz,
                  cleared_by = 'system:expiry'
             from target
            where suppression.finding_id = target.id
              and suppression.cleared_at is null
              and suppression.expires_at <= $6::timestamptz
           returning suppression.id
         ),
         active as (
           select suppression.id
             from supply_finding_suppressions as suppression
             join target on target.id = suppression.finding_id
            where suppression.cleared_at is null
              and suppression.expires_at > $6::timestamptz
         ),
         inserted as (
           insert into supply_finding_suppressions
             (finding_id, reason, created_by, created_at, expires_at)
           select target.id, $4, $3, $6::timestamptz, $5::timestamptz
             from target
             cross join (select count(*) as expired_count from expired) as expiry_gate
            where not exists (select 1 from active)
              and expiry_gate.expired_count >= 0
           on conflict do nothing
           returning id
         )
         select case
                  when exists (select 1 from inserted) then 'suppressed'
                  when not exists (select 1 from target) then 'not_found'
                  else 'already_suppressed'
                end as outcome`,
        [finding, repository, createdBy, suppressionReason, expiresAt.toISOString(), now.toISOString()],
      );

      return suppressionOutcome(rows(result)[0]?.outcome);
    },

    async clearSuppression(repositoryId, findingId, actor, now) {
      const repository = requiredIdentifier(repositoryId, "repositoryId");
      const finding = requiredIdentifier(findingId, "findingId");
      const clearedBy = requiredIdentifier(actor, "actor");
      if (clearedBy.length > 128) throw new Error("actor must be at most 128 characters");

      const result = await executor.query(
        `with target as (
           select finding.id
             from board_supply_findings as finding
             join boards on boards.id = finding.board_id
            where finding.id = $1
              and boards.repository_id = $2
              and finding.resolved_at is null
         ),
         cleared as (
           update supply_finding_suppressions as suppression
              set cleared_at = $4::timestamptz,
                  cleared_by = $3
             from target
            where suppression.finding_id = target.id
              and suppression.cleared_at is null
              and suppression.expires_at > $4::timestamptz
           returning suppression.id
         )
         select case
                  when exists (select 1 from cleared) then 'cleared'
                  when not exists (select 1 from target) then 'not_found'
                  else 'not_suppressed'
                end as outcome`,
        [finding, repository, clearedBy, now.toISOString()],
      );

      return clearSuppressionOutcome(rows(result)[0]?.outcome);
    },
  };
}
