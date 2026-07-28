# Tenant-scoped audit logs

Issue: #43

## Goal

BoardReadyOps records security-relevant lifecycle events for installations, repositories, runners, release runs, policies, and artifacts without crossing tenant boundaries or persisting secret material.

## Audit event scope

Audit events should cover:

- GitHub App installation creation, update, suspension, and deletion attempts,
- repository addition, removal, enablement, and disablement,
- release-run queue, dispatch, completion, failure, timeout, cancellation, and supersession,
- GitHub Check Run creation and completion,
- runner registration creation, activation, heartbeat, disablement, and rotation,
- policy selection and policy changes,
- artifact upload, download, deletion, and expiry,
- safe-mode skip and override decisions.

## Tenant boundary

Every audit event has a mandatory `installation_id`. Optional repository, release-run, artifact, and runner dimensions are validated at insertion time:

- a repository must belong to the event installation,
- a release run must belong to the event repository,
- an artifact must belong to the event release run,
- a runner registration must belong to the event installation.

A release-run dimension therefore requires a repository dimension, and an artifact dimension requires a release-run dimension. The database rejects cross-installation and cross-resource chains.

## Event shape

Each event contains:

- a lowercase UUID event ID,
- installation ID,
- normalized event type,
- normalized actor type,
- optional bounded actor ID and login,
- normalized subject type,
- optional bounded subject ID,
- optional repository, release-run, artifact, and runner-registration IDs,
- optional bounded request or delivery ID,
- bounded JSON-object metadata,
- creation timestamp.

Event, actor, and subject types use lowercase dot, underscore, or hyphen-delimited identifiers. Metadata must be a JSON object and is limited to 64 KiB by PostgreSQL storage size.

## Append-only behavior

`audit_events` is append-only at the database layer. PostgreSQL triggers reject direct `UPDATE` and `DELETE` operations, including mutations caused by deleting referenced resources. Resource deletion therefore requires an explicit audit-retention maintenance procedure rather than silently rewriting or removing audit history.

The initial foundation does not provide such a maintenance procedure. Operators must preserve the audit table and its backup before any exceptional database-level intervention.

## Query contract

All application queries must include `installation_id`. Indexes support deterministic reverse-chronological pagination and tenant-scoped filtering by:

- event type,
- repository,
- release run,
- artifact,
- runner registration,
- request or delivery ID.

Indexes include event ID as a tie-breaker for stable pagination when timestamps are equal.

## Security rules

- Never store credentials, authorization headers, cookies, private keys, webhook signatures, raw webhook payloads, or artifact contents.
- Persist stable identifiers and the minimum metadata required for incident reconstruction.
- Treat metadata as untrusted input and construct it from explicit allowlists in future write helpers.
- Do not derive authorization from audit metadata.
- Do not query audit events without an installation predicate.
- Do not bypass append-only protection in normal application code.

## Authenticated operator export

Operators can export bounded, privacy-safe audit summaries through:

```text
GET /api/v1/operator/installations/{installationId}/audit-events
```

The route uses the existing `BOARDREADYOPS_OPERATOR_API_TOKEN` Bearer token and
`BOARDREADYOPS_OPERATOR_ACTOR_ID` configuration. The installation identifier is
part of the path and remains mandatory for every database query. Optional query
filters are:

- `repositoryId`
- `releaseRunId`
- `eventType`
- `limit`, from 1 to 100, defaulting to 50
- an opaque `cursor` returned by the previous page

Pagination is ordered by `(created_at, id)` in reverse chronological order, so
events with the same timestamp are not skipped or duplicated. Responses set
`Cache-Control: no-store` and do not expose raw webhook payloads, artifact
contents, database errors, or internal storage locators.

The export returns stable identifiers, actor and subject dimensions, repository
full name, event timestamp, and a metadata allowlist containing only bounded
primitive values required for operational reconstruction. Unknown keys, nested
objects, credential-like fields, publication error bodies, and oversized strings
are omitted even if legacy rows contain them. Authorization is never derived from
audit metadata.

Example:

```bash
curl --fail --silent --show-error \
  --header "Authorization: Bearer ${BOARDREADYOPS_OPERATOR_API_TOKEN}" \
  "https://boardreadyops.example/api/v1/operator/installations/INSTALLATION_ID/audit-events?releaseRunId=RUN_ID&limit=50"
```

## Current implementation status

The database provides tenant-chain validation, append-only triggers, deterministic
query indexes, and audit writes for runner registration, runner leases, runner
results, artifact upload, dead-letter replay, and reconciliation operations. The
authenticated operator export provides the first supported query surface.

Issue #43 remains open for installation/repository enablement events, policy and
waiver event coverage, artifact download/deletion events, authenticated product
UI or customer export, retention controls, and complete release-decision
reconstruction tests.
