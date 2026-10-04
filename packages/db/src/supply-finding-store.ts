import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type SupplyFindingAcknowledgementOutcome = "acknowledged" | "already_acknowledged" | "not_found";

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
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function acknowledgementOutcome(value: unknown): SupplyFindingAcknowledgementOutcome {
  return value === "acknowledged" || value === "already_acknowledged" ? value : "not_found";
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
  };
}
