# Production outcome design-partner validation

Use this runbook when validating the release-linked production outcome pilot with a real design
partner batch. The goal is to prove that the existing CSV/JSON workflow helps explain a production
risk without turning a correlation into a causal claim.

This runbook does **not** replace the data contract in [Production outcomes pilot](../production-outcomes.md).
It defines the evidence needed to move issue #450 from implementation validation to externally
validated.

## Guardrails

- Use a partner-approved, non-demo production batch tied to a real BoardReadyOps release.
- Do not commit the partner CSV/JSON, API token, manufacturer-private notes, defect details, or
  production identifiers to this repository.
- Use the release run ID as the explicit manual mapping. Do not infer release identity from dates,
  filenames, or timestamps.
- Record the source SHA-256 returned by BoardReadyOps; do not copy the source payload into a
  validation report.
- Treat release-to-release differences as investigation evidence. Do not state that a release
  caused a yield or defect change unless an independent manufacturing investigation established
  causality.
- Deep MES/vendor integration remains out of scope for this validation.

## Before the session

Identify:

1. The repository ID and exact BoardReadyOps release run ID for the manufactured revision.
2. A real production batch with:
   - manufacturer/site,
   - manufactured date,
   - quantity,
   - first-pass yield when available,
   - rework and scrap counts when available,
   - at least one AOI, SPI, functional-test, NCR, or RMA observation when applicable.
3. An earlier release with production evidence if the validation question requires a comparison.
4. A repository-scoped token with `runs:write`.
5. A partner-approved question to investigate, for example:
   - Did first-pass yield change after this release?
   - Which defect family appeared or increased after this release?
   - Did rework or scrap change between the current release and the previous release with evidence?

Do not invent missing manufacturing metrics. Optional fields may remain absent.

## Import a real batch

Keep the real source outside the repository worktree.

```bash
export BOARDREADYOPS_ORIGIN="https://boardreadyops.com"
export BOARDREADYOPS_REPOSITORY_ID="<repository-id>"
export BOARDREADYOPS_RUN_ID="<release-run-id>"
export BOARDREADYOPS_SOURCE="/secure/path/partner-batch.csv"
```

Import the exact source bytes:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $BOARDREADYOPS_TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary "@$BOARDREADYOPS_SOURCE" \
  "$BOARDREADYOPS_ORIGIN/api/v1/runs/$BOARDREADYOPS_RUN_ID/production-outcomes?repositoryId=$BOARDREADYOPS_REPOSITORY_ID&sourceName=design-partner-validation.csv"
```

A new immutable batch returns `201`. Preserve only the returned identifiers and `sourceSha256` in
the validation notes.

For JSON integrations, use the same endpoint and the canonical object documented in
[Production outcomes pilot](../production-outcomes.md). The route applies the same repository and
release-membership authorization boundary.

## Verify immutable replay

Send the **same source bytes** to the same release again. The replay must return `200` rather than
create a second batch.

Then make a disposable local copy, change one immutable value such as quantity or manufacturer,
and submit it with the same logical batch identity. The service must fail closed with `409`.

Delete the disposable modified copy after the check. Do not attach it to the issue or PR.

This proves that the validation evidence is reproducible and that later conflicting data cannot
silently rewrite the original batch.

## Inspect the release investigation

Open the exact release run in BoardReadyOps and inspect **Production outcomes**.

Confirm that the UI shows the evidence needed for review:

- manufacturer and manufactured date,
- batch identity and quantity,
- first-pass yield, rework, and scrap when supplied,
- normalized defect family and manufacturer-provided defect code,
- notes/corrective action when supplied,
- source digest/provenance,
- the previous release with production evidence when one exists,
- release-to-release aggregate comparison,
- explicit wording that correlation does not establish causality.

Open the underlying batch evidence rather than relying only on the aggregate comparison.

## Answer one useful production-risk question

The validation only counts when a partner can use the release-linked evidence to answer or sharpen
at least one real investigation question.

Record:

- **Question** — the production risk being investigated.
- **Observed evidence** — the relevant release/batch metrics and defect families.
- **Comparison** — the earlier release/batch evidence used, if any.
- **Decision or next investigation step** — what the team did because the evidence was linked to
  the release.
- **Causality boundary** — what remains unknown and what additional manufacturing evidence would
  be required before claiming cause.

A valid outcome can be “the evidence ruled out the release as the likely explanation” or “the
evidence identified a change worth investigating.” The pilot is about decision usefulness, not
forcing a positive correlation.

## Validation record

Keep customer-sensitive material in the partner-approved system of record. The GitHub issue may
contain only a redacted summary with no raw production payload.

Use this template:

```text
Validation date:
Partner identifier: <redacted/internal alias>
Repository: <redacted or approved name>
Release run ID: <approved identifier or redacted>
Batch count:
Manufacturer count:
Import path: CSV | JSON API
New import result: 201
Exact replay result: 200
Conflict check result: 409
Source SHA-256 recorded: yes | no
Earlier release comparison available: yes | no

Investigation question:
Evidence used:
Decision / next investigation step:
Causality boundary:

Acceptance:
[ ] Real partner batch linked to the exact release
[ ] Multiple batches/manufacturers supported when present
[ ] Underlying provenance/evidence inspected
[ ] Release-to-release comparison exercised when applicable
[ ] At least one useful production-risk workflow demonstrated
[ ] No unsupported causal claim made
[ ] No partner payload or credential committed to Git
```

## Completion rule for issue #450

Do not close #450 because synthetic fixtures pass. Close it only after a real design-partner run
satisfies the checklist above and a redacted validation summary records at least one workflow that
helped identify, explain, or rule out production risk.

If the partner workflow repeatedly needs bulk import, vendor-specific mapping, or MES automation,
record that demand separately before expanding the integration surface.
