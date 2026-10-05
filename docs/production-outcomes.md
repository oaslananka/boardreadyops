# Production outcomes pilot

BoardReadyOps can link a manufacturing batch back to the exact release run that produced it. The pilot accepts a bounded CSV upload, stores the source digest and batch provenance, and exposes the imported evidence on the run investigation page for release-to-release comparison.

This is deliberately a small feedback surface rather than an MES integration. It records observed production outcomes so teams can investigate correlations such as a yield change after a release; it does not claim that a release caused a manufacturing outcome.

## Simple JSON API

The same release-scoped endpoint accepts one canonical batch as `application/json`. This is the
small integration surface for partners or internal tooling that already have structured
manufacturing data and do not need to generate CSV first.

```bash
curl -X POST \
  -H "Authorization: Bearer $BOARDREADYOPS_TOKEN" \
  -H "Content-Type: application/json" \
  "https://boardreadyops.com/api/v1/runs/<run-id>/production-outcomes?repositoryId=<repository-id>&sourceName=partner-api" \
  --data '{
    "externalBatchId": "LOT-JSON-7",
    "manufacturer": "Acme EMS",
    "manufacturedOn": "2026-10-03",
    "quantity": 80,
    "firstPassYieldBps": 9875,
    "reworkCount": 1,
    "scrapCount": 0,
    "defects": [
      { "category": "aoi", "code": "BRIDGE", "count": 2 }
    ]
  }'
```

`firstPassYieldBps` is basis points (`9875` = `98.75%`), avoiding the ratio/percent ambiguity
accepted by CSV. Unknown fields and invalid types are rejected rather than silently discarded.
The exact JSON request bytes are SHA-256 hashed and stored as provenance; the payload itself is not
duplicated into a generic blob column.

The run ID in the URL is the manual mapping to the exact BoardReadyOps release identity. The same
repository authorization and release-membership checks used by CSV imports apply before the batch
is written.

## Import one batch

Use a repository-scoped API token with the `runs:write` scope:

```bash
curl --fail-with-body \
  -X POST \
  -H "Authorization: Bearer $BOARDREADYOPS_TOKEN" \
  -H "Content-Type: text/csv" \
  --data-binary @production-lot-7.csv \
  "https://app.boardreadyops.com/api/v1/runs/<run-id>/production-outcomes?repositoryId=<repository-id>&sourceName=production-lot-7.csv"
```

The route first applies the normal repository authorization boundary and then verifies that `<run-id>` belongs to that exact repository. A repository-scoped token therefore cannot attach manufacturing evidence to a release in another repository, even when both repositories belong to the same GitHub App installation.

CSV imports are limited to 2 MiB and **one production batch per request**. A batch may contain multiple defect rows. Rejecting multi-batch files keeps this first pilot atomic with the current immutable batch store rather than risking a partially imported file.

## CSV columns

Required columns:

| Column | Meaning |
| --- | --- |
| `batch_id` | Manufacturer/CM batch identity. |
| `manufacturer` | Contract manufacturer or production site name. |
| `manufactured_on` | Calendar date in `YYYY-MM-DD` format. |
| `quantity` | Positive integer number of manufactured units. |

Optional batch columns:

- `first_pass_yield` — ratio from `0` to `1`, or a percentage such as `97.25%`.
- `rework_count`
- `scrap_count`
- `notes`
- `corrective_action`

Optional defect columns:

- `defect_kind` — `aoi`, `spi`, `functional_test`, `ncr`, or `rma`
- `defect_code`
- `defect_count`
- `defect_notes`

Repeat the same batch metadata on additional rows to attach multiple defect codes to one batch. Metadata must remain identical across all rows for that batch.

## Result and replay behavior

A new import returns HTTP `201`; an exact immutable replay returns HTTP `200`. Both responses include:

- `batchId`
- `created`
- `releaseRunId`
- `sourceSha256`

The SHA-256 digest is calculated from the uploaded CSV bytes and stored with the production batch. Reusing the same batch identity with conflicting immutable evidence fails closed with HTTP `409`.

Validation failures return `400`; an oversized body returns `413`; unsupported media types return `415`. Database/store errors are not echoed back to the caller.

## What remains out of scope

The pilot does not yet provide bulk multi-batch transactions, vendor-specific MES adapters, or automatic causal claims. Those should be added only after repeated design-partner demand demonstrates that the release-linked CSV/API workflow is insufficient.
