# ADR-0014: Rename the top plan tier from `team` to `business`

- **Status:** Accepted
- **Date:** 2026-08-27
- **Relates to:** [ADR-0011 — Continuous supply watch](0011-continuous-supply-watch.md)

## Context

The 27 Aug 2026 product strategy plan repositions BoardReadyOps around
collaboration — review, disposition, evidence — priced per active
contributor (a seat), with tiers named Free / Team / Business / Enterprise.
`packages/cloud-core/src/entitlements.ts` already had a `PlanTier` enum, but
it did not match: `["free", "pro", "team"]`, metered entirely by watched
board count, with `team` as the *top* tier (100 boards, unlimited evidence
retention, supply watch, handoff links). The new naming makes `Team` the
*entry-level* paid tier, with `Business` above it.

That collision is the whole risk in this change.
`planTierOf(value)` (`entitlements.ts:44-47`) resolves any string not in
`planTiers` to `"free"`, by design — a row written by a newer deployment
must not take the control plane down. That means a stored value is only
ever as safe as the *meaning currently assigned to it*. If the code started
treating `"team"` as the new, lower-limit entry tier before every
installation currently holding the *old* meaning of `"team"` was moved
somewhere else, every one of those installations would be silently
downgraded from 100 watched boards and unlimited retention down to whatever
the new entry tier allows — with no error, no failed request, nothing an
operator would notice without comparing before/after board counts by hand.

`installations.plan_tier` (`packages/db/migrations/0001_cloud_schema.sql:16`)
is a bare `text` column with no CHECK constraint — nothing at the schema
level would catch a stale value either.

## Decision

Rename the tier set to `["free", "team", "business"]`
(`packages/cloud-core/src/entitlements.ts`), and ship a data migration
(`packages/db/migrations/0047_seat_based_entitlement_tiers.sql`) that moves
every installation off the old vocabulary *in the same change* that
introduces the new meaning:

```sql
update installations set plan_tier = 'business' where plan_tier in ('pro', 'team');
```

`business` takes over `team`'s exact former limits (100 watched boards,
unlimited retention, supply watch, handoff links) — literal continuity, no
new numbers invented. The new `team` tier's limits (10 boards, 365-day
retention, supply watch and handoff links enabled) reuse the old `pro`
tier's numbers as a starting default; `business` and `free` are otherwise
unchanged.

`pro` also moves to `business`, not to the new `team`, even though `pro`
customers did not have `team`'s old 100-board allowance. This is the one
place entitlement *increases* rather than stays flat, and it is deliberate:
the new `team` tier's limits are lower than `pro` ever had, so mapping
`pro → team` would be a real entitlement loss for those customers, which is
exactly what this migration exists to prevent. `business` is the only
destination that guarantees every pre-migration tier lands on a tier with at
least its former entitlements. Correcting an over-provisioned installation
down to what its subscription actually pays for is a billing/support
decision, not something a schema migration should decide unilaterally.

Because migrations apply on deploy while already-running pods keep serving
old code and old rows can exist simultaneously with new code expecting new
meanings, `entitlements.ts` and the migration ship together in one change
rather than as a staged two-phase rollout: there is no window where deployed
code assigns the new meaning to `"team"` while any row still holds the old
meaning.

## Consequences

### Positive

- No installation loses entitlements it already had — proved directly by
  `tests/integration/seat-based-entitlement-tiers-migration-postgres.test.ts`
  and by
  `tests/unit/cloud-core/entitlements.test.ts`'s assertion that `business`'s
  limits are at least what the old `team` guaranteed.
- `planTierOf`'s fail-safe-to-`free` behavior now also protects against the
  *specific* failure mode this rename introduces: a stale `"pro"` string
  (impossible after the migration runs, but not impossible to reintroduce by
  hand) degrades to `free` rather than resolving to anything at all, since
  `"pro"` is no longer in `planTiers`.
- `applyWatchAllowance`'s existing graceful-degradation behavior (oldest
  boards keep their watch, newest are suspended rather than deleted) is
  unaffected — this change only touches what a tier is *called* and what its
  limits are, not the downgrade mechanics.

### Negative

- `entitlements.ts` remains board-metered, not seat-metered. The strategy
  plan's actual billable unit — an internal user taking a policy,
  disposition, release, or workspace action within a billing month — has no
  schema yet (no table tracking a billable action per user per month exists).
  This rename establishes the tier *names* and *limits* the seat-based model
  needs to land on; it does not implement seat billing.
- No Stripe integration is wired to any of this. `plan_tier` still only
  changes by direct database write (as it always has) until a billing
  integration exists to keep it current — matching `entitlements.ts`'s
  existing payment-provider-agnostic design.
- The new `team` tier's limits (10 boards, 365-day retention) are a
  reasonable engineering default carried over from `pro`, not a validated
  pricing decision. They are easy to change later; only the migration
  mechanics and the entitlement-preservation guarantee are load-bearing.

## Rejected alternatives

### Two-phase rollout: ship code understanding both meanings first, migrate data later

This is what the original plan called for, and it is the safer approach in
a system with a real, gradual deploy process where old and new code
genuinely run side by side for a meaningful window. It was rejected for
*this* change specifically because there is no such staged deploy pipeline
available to coordinate it through right now — shipping the rename and the
migration together, so that no deployed code ever assigns the new meaning to
a not-yet-migrated row, achieves the same safety property in one step
without depending on rollout infrastructure that does not yet exist.

### Keep `team` as the top tier and name the new entry tier something else (e.g. `starter`)

Rejected because it does not match the product strategy plan's published
tier names (Free / Team / Business / Enterprise), which is the reason for
this change in the first place. Avoiding the rename risk by avoiding the
rename defeats the purpose.

### Add a CHECK constraint on `installations.plan_tier`

Rejected as out of scope for this change. `entitlements.ts`'s
fail-safe-to-`free` design deliberately tolerates an unrecognized stored
value by degrading gracefully at read time rather than rejecting it at
write time; adding a constraint would be a real behavior change to that
existing design, not something this rename needs.

## Rollout

1. **Done.** `entitlements.ts` renamed to the new tier set and limits.
2. **Done.** Migration 0047 moves every `pro`/`team` installation to
   `business`.
3. **Done.** Every call site seeding a literal `"pro"`/`"team"` tier value in
   tests updated to the new vocabulary; a migration-replay integration test
   proves the transformation and its idempotency directly against Postgres.
4. Seat-based billing (the table tracking a billable action per user per
   month, the Stripe integration keeping `plan_tier` current, Checkout/Portal
   flows) is future work — a real Stripe test-mode credential and its own
   schema design are both needed before that can start.
