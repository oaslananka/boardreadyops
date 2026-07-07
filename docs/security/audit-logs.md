# Tenant-scoped audit logs

Issue: #43

## Goal

BoardReadyOps should record security-relevant lifecycle events for installations, repositories, runners, release runs, policies, and artifacts in a tenant-scoped audit log.

## Audit event scope

Audit logs should cover:

- GitHub App installation created, updated, suspended, or deleted,
- repository added, removed, enabled, or disabled,
- release run queued, dispatched, completed, failed, timed out, cancelled, or superseded,
- check run created or completed,
- runner registration created, activated, heartbeated, disabled, or rotated,
- policy preset selected or changed,
- artifact uploaded, downloaded, deleted, or expired,
- safe-mode skip or override decision.

## Tenant boundary

Every audit event must be scoped to an installation. Repository, run, runner, and artifact ids should be optional dimensions, but the installation id is mandatory.

## Event shape

Each event should include:

- event id,
- installation id,
- event type,
- actor type,
- actor id or login when known,
- subject type,
- subject id,
- repository id when relevant,
- release run id when relevant,
- artifact id when relevant,
- runner registration id when relevant,
- request id or delivery id when relevant,
- JSON metadata,
- creation timestamp.

## Security rules

- Do not store secrets or raw webhook payloads.
- Do not store artifact contents.
- Store stable identifiers and minimal metadata.
- Audit logs are append-only at the application level.
- Tenant queries must filter by installation id.

## Acceptance criteria

- Core lifecycle paths can write audit events.
- Audit events can be queried by installation.
- Events can be filtered by repository, run, artifact, runner, and event type.
- Sensitive values are not persisted in audit metadata.
