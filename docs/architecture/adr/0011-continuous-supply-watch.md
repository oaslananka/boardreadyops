# ADR-0011: Boards as first-class cloud entities and continuous supply watch

- **Status:** Proposed
- **Date:** 2026-08-24
- **Relates to:** [ADR-0010 — Target-repository GitHub Actions execution](0010-target-repository-github-actions-execution.md), [Cloud data model](../cloud-data-model.md)

## Context

BoardReadyOps Cloud evaluates a repository when a commit event arrives. Every
run is triggered by a pull request, and every finding is discarded and
recomputed on the next run.

That model does not match how hardware fails. A KiCad design is static between
release cycles, but the supply chain around it is not. A component specified in
March can move to NRND in July with no commit, no webhook, and no run. The team
discovers it when ordering production quantities.

The rules to detect this already exist in the CLI: `bom.lifecycle`,
`bom.eol-detection`, `bom.risk-score`, `bom.single-source`, and
`bom.unknown-lifecycle` under `src/rules/bom/`. They are limited by their data
source, not their logic. `src/rules/bom/lifecycle.ts` calls
`loadLifecycleDatabase(context.root, ...)`, which reads a repository-local file.
The rule can therefore only report lifecycle risk that someone already recorded
by hand. It cannot report the risk nobody knows about yet.

`src/bom/lifecycle.ts` anticipated this. `LifecycleSourceType` already declares
`"supplier-plugin"` alongside `"bom-field"` and `"lifecycle-db"`, and
`LifecycleMetadata` already carries a `fetchedAt` provenance timestamp. The
abstraction was built for a live data source that does not exist yet.

Two structural gaps block that source from being added:

1. **The cloud has no board identity.** `packages/db/prisma/schema.prisma` models
   `Installation → Repository → ReleaseRun → Finding`. There is no board or
   project entity, even though the CLI attributes every finding to a specific
   `.kicad_pro` project (see [Multi-project workspaces](../../multi-project.md)).
   A hardware monorepo with four boards is four independent supply-risk
   surfaces, and the cloud currently cannot tell them apart.
2. **The cloud never receives the BOM.** `releaseRunResultBaseSchema` in
   `packages/contracts/src/index.ts` transmits findings, artifacts, metrics,
   report links, readiness, waivers, and hardware impact. It does not transmit
   the component list. `findingSchema` has no `project` field, so even the
   attribution the CLI computed is dropped at the boundary.

Without board identity and a persisted BOM, there is nothing for a scheduled job
to re-evaluate.

## Decision

Introduce **Board** as a first-class cloud entity, persist a **BOM snapshot** per
board per release run, and re-evaluate those snapshots on a schedule against a
hosted component-intelligence source.

### Board identity

A board is identified by its KiCad project path within a repository, which is
the same identity the CLI already reports in the `project` field of a finding.
`(repository_id, project_path)` is unique. Boards are discovered from run
results, never configured by hand.

### BOM snapshots are append-only

Each terminal release-run result may carry one BOM per board. The control plane
stores it as an immutable snapshot rather than overwriting a mutable component
list. Append-only snapshots serve three purposes at once:

- the evidence record shows which components a shipped revision actually used;
- consecutive snapshots can be diffed, which the contract already anticipates
  through the `"bom"` value in `hardwareImpactDomainSchema`; and
- the newest snapshot for a board is the input to supply watch.

### Supply watch

A scheduled control-plane job re-evaluates the current snapshot of each active
board against refreshed component lifecycle and availability data, and raises
supply findings that are attributed to the board rather than to a run. The
evaluation is time-triggered, not commit-triggered.

### Open-core boundary

This establishes an honest split rather than a feature gate:

| | Runs where | Answers |
|---|---|---|
| CLI and Action (free, open source) | The user's runner | Is this design correct right now? |
| Cloud (hosted, paid) | Control plane, on a schedule | Has the world moved under this design since? |

The CLI is not degraded to create the paid tier. Continuous evaluation requires
persistent state, scheduled execution, and a maintained data source, none of
which a 60-second runner process can provide.

## Consequences

### Positive

- Existing BOM rule logic gains a live data source without being rewritten.
- Value is delivered while the customer is not working, which is what justifies
  a recurring subscription.
- The board becomes the product's core noun, matching how hardware engineers
  think, and a natural billing unit that scales with customer value rather than
  with seat count.
- BOM snapshots strengthen the release evidence record for regulated teams.

### Negative

- The result contract grows. The runner must collect and transmit BOM rows,
  increasing payload size and requiring a bounded row limit.
- Component data must be sourced from a third-party provider with its own cost,
  rate limits, and terms. Provider choice is deliberately deferred to a separate
  decision; this ADR only requires that the source be replaceable.
- Scheduled evaluation is new operational surface: it needs the same lease,
  retry, and dead-letter discipline as the existing webhook job pipeline.
- Board identity depends on project paths, which change when a repository is
  reorganized. A renamed board appears as a new board until an explicit merge
  path exists.

## Rejected alternatives

### Keep supply checks commit-triggered only

Rejected because it cannot detect the failure mode that matters. No commit
occurs between a design freeze and a production order, which is exactly the
window in which components go obsolete.

### Ship a lifecycle database file to repositories on a schedule

Rejected because it puts a rapidly changing dataset under version control,
creates noisy commits in customer repositories, and still requires the customer
to merge the update before any risk is visible.

### Model the BOM as a mutable component list per board

Rejected because it destroys the evidence record. A shipped revision's component
list must remain readable after the design moves on, and BOM diffing between
revisions requires both sides to still exist.

### Attribute supply findings to a synthetic release run

Rejected because a run represents an execution of the pipeline against a commit.
A supply finding raised on a schedule has no commit and no execution, and
recording one would corrupt run history and readiness scoring.

## Rollout

1. **Done.** Extend the result contract with optional board attribution and BOM
   rows, so older runners remain compatible.
2. **Done.** Add the `boards`, `board_bom_snapshots`, and `board_bom_components`
   tables (schema v40) and persist snapshots on terminal result ingestion.
3. **Done.** Emit BOM rows from the CLI, the self-hosted runner, and the hosted
   GitHub Actions workflow.
4. **Done.** Surface boards and their captured component list in the dashboard.
5. Add the component-intelligence provider interface and one implementation
   behind it.
6. Add the scheduled evaluation job and its notification surface.

Steps 5 and 6 depend on a provider decision recorded separately in
[ADR-0012](0012-component-intelligence-provider.md); no provider interface is
fixed until that decision is made.

### What step 3 established

Board attribution only accepts a BOM the project can claim: a declared override,
an explicit workspace `--bom`, or a file inside the project's own directory.
Without one it falls back to that project's schematic rather than to a
workspace-wide file search, which would otherwise hand one board's BOM to every
other board in a monorepo and drive supply findings against parts a board never
used.
