# Release-to-production Evidence Graph

BoardReadyOps uses a small **storage-neutral domain graph** to explain one release across time. It
does not require a graph database and it does not copy source content into a second system of
record.

The graph contract lives in `packages/cloud-core/src/evidence-graph.ts`. The run investigation
adapter in `apps/web/lib/run-evidence-graph.ts` maps already-authorized dashboard data into that
contract.

## Root and stable identities

Every investigation is rooted at one BoardReadyOps release run.

| Node | Stable identity |
| --- | --- |
| release | BoardReadyOps release run id |
| source | repository id + exact commit SHA |
| evidence | persisted artifact id |
| review | review id |
| policy | policy/preset identity and version when recorded |
| approval | persisted approval id |
| waiver | persisted decision/waiver id |
| production batch | immutable production batch id |

Relationships are intentionally small: `derived_from`, `supported_by`, `reviewed_in`,
`governed_by`, `approved_by`, `waived_by`, and `produced`.

The release points backward to the exact source and evidence that supported it. Review governance
hangs from the linked review. Production batches point forward from the same release identity.

## Missing evidence is data

The graph never treats an unloaded or absent relationship as proof that nothing existed.

For example, the run dashboard currently loads a linked review id and setup-policy context but does
not load approval and waiver history. The adapter therefore records those relationships under
`missing` with an explicit reason. An empty, deliberately loaded approval list is different from
an approval list that was never loaded.

The same rule applies to releases with no production outcomes yet: the forward production
relationship is explicitly absent instead of silently disappearing.

## Investigation workflow

The run **Audit** view renders three bounded views from the graph:

1. **Backward context** — exact source commit, persisted evidence artifacts, linked review, and
   recorded policy context.
2. **Forward outcomes** — production batches linked to that exact release.
3. **Missing relationship context** — governance/evidence/outcome relationships the current read
   model cannot prove.

This is enough to answer a real longitudinal question without graph infrastructure: “What exact
source and evidence supported this release, and what production outcomes were later linked to it?”

The existing production comparison remains deliberately correlational. A yield or defect change
after a release is evidence for investigation; it is not causal proof.

## Privacy and audit boundary

The Evidence Graph contains dashboard-visible metadata and integrity references (for example SHA-256
digests). It does not expand the operator audit export, ingest raw repository source, or create a
new copy of production evidence bytes.

Specialized graph infrastructure should only be considered if real historical datasets show query
patterns that cannot be served by the existing relational storage plus this domain model.
