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

Aggregates catalogue, lifecycle, and distributor stock across many distributors through one
GraphQL API. Broadest single-source coverage, self-serve onboarding, documented for
programmatic use.

**Its published terms rule out the shared-cache model.** Read on 2026-08-24 at
[nexar.com/api/legal](https://nexar.com/api/legal):

| Clause | Text | Consequence |
|---|---|---|
| §1.2(vi) | prohibits "use the Nexar API to cache and/or store data for more than twenty-four (24) hours" | A weekly or even daily watch cannot reuse a cached answer beyond one day. |
| §1.1 / §1.2(i) | a "non-exclusive, revocable, non-transferable, non-sublicensable, limited license"; may not "sublicense, lease, loan, assign, commercially share or otherwise transfer or distribute" | One installation's result may not answer another installation's question, so a cross-tenant cache is not available. |
| §1.6 | "mass aggregation of Altium data for predictive analytics of any kind is prohibited"; excludes "historical trends in pricing and inventory" | The accumulated observation history cannot become a retained dataset or an analytics asset. |

This does not disqualify Nexar; it disqualifies operating Nexar as one shared BoardReadyOps
subscription serving every customer. Under a customer's own credentials the same terms are
satisfiable, because each licensee queries for themselves.

These clauses are quoted from the public page on the date above and are not legal advice.
Confirm the current terms, and anything a negotiated agreement changes, before relying on them.

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

**Customer-supplied credentials are the default; a shared subscription is the exception.**

The caching question this ADR was written to raise now has an answer for the leading
candidate, and the answer is no. Nexar's terms forbid both the retention window and the
cross-tenant reuse a shared hosted cache depends on. Any provider aggregating distributor
data is likely to carry similar terms, because the restriction protects their suppliers
rather than being a Nexar preference.

So the shape inverts from what this ADR first assumed: BoardReadyOps performs lookups under
each customer's own credentials and retains only what that customer already has rights to.
A BoardReadyOps-operated subscription remains possible for any provider whose terms permit
serving multiple end customers, but that is now the case to prove rather than the default.

Reasoning:

- The interface, not the vendor, is the durable decision. `LifecycleSourceType`
  already models multiple sources, so no single provider needs to be permanent.
- Per-customer credentials satisfy restrictive terms without renegotiating them, and
  remove the per-lookup cost from BoardReadyOps' own margin.
- It changes what the paid tier sells: not resold component data, but the scheduling,
  attribution, history, and alerting around data the customer is already entitled to.
  That is defensible under any provider's terms.

The cost is a worse first run: a customer must obtain a key before the watch does anything.
The `no_provider` outcome already models that state honestly rather than reporting a board as
clean, so the gap is visible rather than silent.

### Encoded in the implementation

`ProviderCachePolicy` makes these limits part of the provider contract rather than a comment:

- `maximumCacheAgeMs` clamps retention. A deployment may refresh more often than the licence
  requires, never less, and a provider suggesting a longer expiry cannot extend it.
- `shareableAcrossTenants: false` bypasses the shared observation cache entirely — no read and
  no write — so one licensee's answer can never serve another.

A provider cannot be plugged in without declaring both, and both are covered by tests.

### Still to confirm per provider

1. whether derived state — "this MPN was NRND on this date" — may be retained after the cached
   record expires, since the evidence record depends on it and §1.6-style clauses restrict it;
2. rate limit and cost per lookup at the volume a scheduled watch implies; and
3. whether attribution is required wherever the data is displayed.

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
