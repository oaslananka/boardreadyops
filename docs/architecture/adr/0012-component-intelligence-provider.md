# ADR-0012: Component intelligence provider for supply watch

- **Status:** Proposed — requires a commercial decision before implementation
- **Date:** 2026-08-24
- **Blocks:** [ADR-0011](0011-continuous-supply-watch.md) rollout steps 5 and 6

## Context

[ADR-0011](0011-continuous-supply-watch.md) established board identity and
append-only BOM snapshots. The control plane now knows which components each
board shipped with. It does not yet know anything about those components beyond
what the customer's own BOM recorded.

`src/bom/lifecycle.ts` already anticipated this. `LifecycleSourceType` declares
`"supplier-plugin"` alongside `"bom-field"` and `"lifecycle-db"`, and
`LifecycleMetadata` carries a `fetchedAt` provenance timestamp. The socket
exists; nothing is plugged into it.

Choosing what plugs in is not primarily a technical decision. It commits the
project to a vendor's cost model, rate limits, and — most importantly — terms
that govern whether the returned data may be stored at all. That last point
shapes the architecture, so it must be settled before an interface is fixed.

## Decision required

This ADR does not decide. It records the options, the constraint that actually
matters, and a recommendation, so the decision can be made deliberately.

## The constraint that shapes everything: caching rights

Supply watch re-evaluates every active board on a schedule. A naive design
queries the provider once per component per run. For a customer with 20 boards
of 300 components evaluated weekly, that is 6,000 lookups per week per customer,
and most of those components are the same commodity parts across every customer.

Caching lifecycle data across tenants collapses that cost by orders of magnitude
and is the difference between a viable margin and an unviable one. It is also,
over time, an asset: an accumulated history of when parts changed state.

**Many component data providers restrict exactly this.** Terms commonly prohibit
storing, redistributing, or building a derived database from returned results.
Whether the chosen provider permits a shared cache — and for how long — must be
confirmed in writing before implementation, because the answer changes the cost
model, the margin, and the schedule the watch can run on.

Do not treat this as a detail to settle later. It is the decision.

## Options

### Nexar (Octopart)

Aggregates catalogue, lifecycle, and distributor stock across many distributors
through one GraphQL API. Broadest single-source coverage, self-serve onboarding,
documented for programmatic use.

Trade-off: usage-based cost that scales with lookups, so the caching terms
determine whether it is affordable at scale.

### Distributor APIs (Digi-Key, Mouser, and peers)

Free or low-cost with registration, and authoritative for that distributor's own
catalogue and stock.

Trade-off: each covers only its own catalogue and its own view of lifecycle, so
coverage is partial and inconsistent across vendors. Running several multiplies
integration and reconciliation work. Best as a supplement or as a
customer-supplied key, not as the sole source.

### Enterprise obsolescence databases (SiliconExpert, Z2Data, and peers)

The most authoritative PCN/EOL data, which is precisely what supply watch exists
to surface.

Trade-off: enterprise contracts and pricing that do not fit a self-serve product
at this stage. Realistic as a "bring your own subscription" path for large
customers rather than as the default.

### Customer-supplied credentials

The customer configures their own provider key; BoardReadyOps performs lookups
on their behalf and stores only the results they already have rights to.

Trade-off: sidesteps both the cost and the caching-rights problem, but gives a
worse first-run experience and does not work for self-serve signup. Valuable as
an enterprise option alongside a default provider.

## Recommendation

Adopt a **provider-agnostic interface with Nexar as the first implementation**,
and treat customer-supplied credentials as a first-class alternative rather than
an afterthought.

Reasoning:

- The interface, not the vendor, is the durable decision. `LifecycleSourceType`
  already models multiple sources, so no single provider needs to be permanent.
- Nexar gives the broadest coverage from one integration, which matters most
  while the feature is proving its value.
- Customer-supplied credentials cover the enterprise case and the case where
  caching terms turn out to be too restrictive to operate a shared cache.

Before implementing, confirm in writing:

1. whether results may be cached, for how long, and whether a cache may be
   shared across customers;
2. whether derived state — "this MPN was NRND on this date" — may be retained
   after the cached record expires, since the evidence record depends on it;
3. the rate limit and cost per lookup at the volume a weekly watch implies; and
4. whether attribution is required where data is displayed.

If caching across tenants is not permitted, the shared-service model does not
work at acceptable cost and customer-supplied credentials should become the
default rather than the alternative. That outcome is survivable, but it must be
discovered before the scheduled job is built, not after.

## Consequences

### Positive

- Existing BOM rule logic gains a live data source without being rewritten.
- A provider interface keeps the vendor replaceable as coverage, terms, or cost
  change.
- Confirming caching rights first prevents building a scheduled job whose
  economics only fail at scale.

### Negative

- A dependency on a third party for the feature that differentiates the paid
  tier, including their availability and their pricing changes.
- Cached lifecycle data can be stale; every surfaced result must carry its
  `fetchedAt` provenance so a reader knows how fresh the claim is.
- Coverage will never be complete. Parts without a manufacturer part number
  cannot be matched at all, which is why the dashboard already reports how many
  components lack one.

## Open questions

- Does the watch evaluate every active board on a fixed schedule, or only boards
  whose most recent release is still the deployed revision?
- Is a lifecycle change a notification, a finding attached to the board, or both?
  ADR-0011 rejected attributing supply findings to a synthetic release run, so
  the surface for a run-less finding still needs defining.
- What is the retention policy for historical lifecycle observations, given they
  are the evidence a team acted on the best information available at the time?
