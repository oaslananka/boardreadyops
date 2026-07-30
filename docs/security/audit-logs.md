# Tenant-scoped audit logs

Related issues: #43 and #44

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

`audit_events` is append-only at the database layer. PostgreSQL triggers reject direct `UPDATE` and `DELETE` operations. A database-owned cascade may remove installation-scoped audit rows only when the parent installation itself is deleted; repository, run, artifact, and runner references otherwise become nullable dimensions rather than rewriting event content.

The current product does not expose installation erasure or an audit-retention maintenance workflow. Operators must not use direct database deletion as a substitute. A future lifecycle operation must define export, legal-hold, backup, and deletion-proof behavior before invoking any parent cascade.

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

## GitHub App lifecycle events

Durably accepted GitHub lifecycle jobs carry their validated delivery ID, event
type, and event action into the metadata store. The store records the following
allowlisted transitions in the same PostgreSQL statement as the state mutation:

- `github_app.installation.enabled` for an `installation` / `created` action,
- `github_app.installation.disabled` for an `installation` / `deleted` action,
- `github_app.installation.suspended` for an `installation` / `suspend` action,
- `github_app.installation.unsuspended` for an `installation` / `unsuspend` action,
- `github_app.repository.enabled` for repository additions during installation
  creation or an `installation_repositories` / `added` action,
- `github_app.repository.disabled` for repository removals during installation
  deletion or an `installation_repositories` / `removed` action.

These events use actor type `github_webhook`. The validated GitHub delivery ID is
stored as the request ID, while the subject ID and optional repository dimension
come from the persisted installation/repository rows. Event IDs are derived
deterministically from the delivery, event type, and external subject ID, so a
worker retry cannot duplicate an already committed event. Suspension and
unsuspension writes are guarded so an event is inserted only when the installation
state transition actually changes `suspended_at`. A delivery whose audit event was
already recorded cannot mutate the installation again, even after a later opposite
transition; repeated or stale deliveries cannot reset the current state or create a
second transition event. Installation and repository metadata refreshes preserve
the current suspension/disabled state, and previously recorded enable/disable
deliveries cannot reverse a later opposite transition.

Event metadata is restricted to the source action, the GitHub installation or
repository ID, and the `repositoryPrivate` visibility boolean where applicable.
Account logins, repository names, webhook signatures, payload bodies, headers, and
credentials are not stored in lifecycle event metadata. Idempotent installation/repository metadata refreshes generated by
`pull_request` events do not produce enablement audit entries.

## Artifact download access events

A signed artifact URL records `artifact.download.started` only after the URL
signature, metadata lookup, local storage containment, regular-file status, and
expected byte count have all been verified. The audit insert completes before
the response stream is created. If the event cannot be persisted, the file handle
is closed and the route returns a stable `503` response without serving bytes.

The event uses actor type `signed_url`, subject type `artifact`, and the validated
installation, repository, release-run, and artifact dimensions derived from the
database relationship chain. Its metadata is limited to the stored byte count,
SHA-256 digest, artifact kind, and artifact role. URL signatures, query strings,
IP addresses, authorization headers, cookies, and raw request headers are not
recorded.

The event name deliberately says `started`: it proves that authorization and file
validation succeeded and that streaming was permitted, but it does not claim that
the client received every byte. Transfer-completion accounting would require a
separate delivery mechanism and event.

## Artifact record deletion events

When an accepted terminal result replaces the artifact set for a release run, each
previous artifact metadata row that is actually deleted produces an
`artifact.record.deleted` event in the same PostgreSQL statement. The event uses
actor type `runner`, subject type `artifact`, and preserves the validated
installation, repository, and release-run dimensions. The deleted artifact ID is
kept as the subject ID; the nullable artifact foreign-key dimension is intentionally
omitted because the referenced row no longer exists.

Metadata is restricted to the replacement reason, result digest, execution-attempt
ID, byte count, SHA-256 digest, artifact kind, and artifact role. Artifact names,
storage paths, report contents, and source payloads are not recorded. If any audit
insert fails, the surrounding result transaction rolls back, so artifact metadata
cannot be deleted without its corresponding audit event. Exact result replay does
not create another deletion event.

This event proves deletion of the BoardReadyOps artifact metadata record. When the
removed storage path is no longer referenced, the same result transaction also
creates a tenant-scoped durable physical-deletion job. The local-storage worker later
records `artifact.object.deleted` with `outcome=deleted` after removing the regular
file or `outcome=missing` when the object was already absent. Unsafe paths,
unsupported storage drivers, and exhausted retries instead produce bounded failure
evidence. This replacement path does not implement general age-based artifact expiry.
See [Data lifecycle and privacy](data-lifecycle.md) for the full storage-boundary and
retention contract.

## Release decision reconstruction

Each accepted `runner.result.persisted` event contains a versioned, privacy-safe
decision summary that can be exported with the existing mandatory installation and release-run
filters. The summary records the normalized decision, persisted conclusion, effective
GitHub Check conclusion, readiness status and score, blocking/non-blocking counts,
missing-output and warning counts, and active/expired/stale waiver counts.

Only bounded primitive summaries are recorded. Finding messages, waiver owners,
waiver reasons, approval identities, evidence references, report contents, and the
raw result payload remain outside audit metadata. The full persisted result stays in
the release-run result store; the append-only audit event provides the stable,
versioned summary needed to reconstruct why the run passed, failed, or required
review without changing the existing result-digest replay contract.

PostgreSQL integration coverage verifies that this summary is tenant-scoped,
release-run-scoped, visible through the operator export, and does not expose waiver
content. Policy preset and waiver mutation history remains separate future scope
because no hosted persistent mutation surface currently exists for those resources.

## Current implementation status

The database provides tenant-chain validation, append-only triggers, deterministic
query indexes, and audit writes for runner registration, runner leases, runner
results, GitHub installation/repository enablement and suspension changes, artifact
upload, signed artifact download starts, artifact-record replacement deletions,
dead-letter replay, and reconciliation operations. The
authenticated operator export provides the first supported query surface.

Issue #44 remains open for general age-based expiry, per-tenant retention controls,
non-local storage deletion, authenticated customer export, erasure, uninstall, backup,
and legal-hold behavior. Result-level release decisions are reconstructable from the
existing tenant-scoped operator export; cross-resource reconstruction will expand as
those remaining lifecycle surfaces are implemented.
