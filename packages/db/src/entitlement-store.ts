import { type PlanTier, planLimits, planTierOf } from "@boardreadyops/cloud-core";
import type { SqlQueryExecutor, SqlQueryResult } from "./lifecycle-store.js";

export type InstallationEntitlement = {
  installationId: string;
  tier: PlanTier;
  watchedBoards: number;
};

export type EntitlementStore = {
  /** Current plan and watched-board count for the installation owning a repository. */
  forRepository(repositoryId: string): Promise<InstallationEntitlement | undefined>;
  /**
   * Enables watch for boards the plan covers and disables the excess.
   *
   * Returns how many boards ended up watched. Boards over the limit are disabled rather than
   * deleted: the evidence stays intact, and raising the plan re-enables them without needing
   * a new release run to rediscover the board.
   */
  applyWatchAllowance(installationId: string, tier: PlanTier): Promise<{ watched: number; suspended: number }>;
};

function rows(result: unknown): readonly Record<string, unknown>[] {
  if (typeof result !== "object" || result === null || !("rows" in result)) return [];
  const value = (result as SqlQueryResult).rows;
  return Array.isArray(value) ? value : [];
}

function count(row: Record<string, unknown> | undefined, key: string): number {
  const value = row?.[key];
  return typeof value === "number" ? value : Number(value ?? 0);
}

export function createSqlEntitlementStore(executor: SqlQueryExecutor): EntitlementStore {
  return {
    async forRepository(repositoryId) {
      const result = await executor.query(
        `select installations.id as installation_id,
                installations.plan_tier,
                (select count(*)::int
                 from board_supply_watch as watch
                 join boards on boards.id = watch.board_id
                 join repositories as scoped on scoped.id = boards.repository_id
                 where scoped.installation_id = installations.id and watch.enabled) as watched_boards
         from repositories
         join installations on installations.id = repositories.installation_id
         where repositories.id = $1`,
        [repositoryId],
      );
      const row = rows(result)[0];
      if (!row) return undefined;
      return {
        installationId: String(row.installation_id),
        tier: planTierOf(typeof row.plan_tier === "string" ? row.plan_tier : undefined),
        watchedBoards: count(row, "watched_boards"),
      };
    },

    async applyWatchAllowance(installationId, tier) {
      // The allowance is read from the shared policy so the number lives in exactly one place.
      const allowance = planLimits(tier).watchedBoards;

      const result = await executor.query(
        `with scoped as (
           select watch.board_id, boards.first_seen_at, boards.id
           from board_supply_watch as watch
           join boards on boards.id = watch.board_id
           join repositories on repositories.id = boards.repository_id
           where repositories.installation_id = $1
         ),
         ranked as (
           -- Oldest boards keep their watch when a plan shrinks, so a downgrade does not
           -- silently stop watching the board a team has depended on longest.
           select board_id, row_number() over (order by first_seen_at, id) as position
           from scoped
         ),
         updated as (
           update board_supply_watch as watch
           set enabled = ranked.position <= $2
           from ranked
           where watch.board_id = ranked.board_id
             and watch.enabled <> (ranked.position <= $2)
           returning watch.board_id, watch.enabled
         )
         select (select count(*) from ranked where position <= $2)::int as watched,
                (select count(*) from ranked where position > $2)::int as suspended`,
        [installationId, allowance],
      );

      const row = rows(result)[0];
      return { watched: count(row, "watched"), suspended: count(row, "suspended") };
    },
  };
}
