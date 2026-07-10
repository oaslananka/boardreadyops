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

## Current implementation slice

This migration provides the tenant-scoped table, structural constraints, tenant-chain validation, append-only triggers, and query indexes. Follow-up work must add allowlisted write helpers, authenticated tenant query surfaces, retention/export procedures, and tests for each lifecycle integration point.
