# Data lifecycle and privacy

This page describes the data lifecycle implemented by the current BoardReadyOps
repository. It is an implementation contract for operators and customers, not a
privacy policy, data processing agreement, or claim that every retention and
erasure workflow is complete.

## Storage boundaries

### GitHub Actions execution boundary

In the target-repository GitHub Actions path, source checkouts, workflow logs, and
GitHub Actions artifacts remain in the customer's GitHub repository and GitHub
Actions boundary. Their retention is controlled by the repository and GitHub
settings, not by the BoardReadyOps control-plane database. BoardReadyOps receives
normalized run results, findings, metadata, report links, and any report artifacts
that the runner explicitly uploads. It does not automatically upload a source
archive.

### BoardReadyOps control-plane boundary

The control plane stores tenant-scoped metadata in PostgreSQL. Optional managed
report artifacts are stored by the configured artifact driver. The currently
implemented physical deletion worker supports `ARTIFACT_STORAGE_DRIVER=local`.
Database backups, reverse-proxy logs, container logs, platform logs, and copies of
the artifact directory are outside the application-level sweeper and must have a
separate operator policy.

### Customer self-hosted runner boundary

The customer self-hosted runner stores its Ed25519 identity under its configured
identity directory and uses temporary source workspaces while a job runs. Temporary
workspaces are removed by default. Enabling `--keep-workspace` deliberately retains
source files for debugging and transfers responsibility for their deletion to the
operator. Workspaces should not be included in general-purpose backups.

## Current data lifecycle matrix

| Data class | Stored content and scope | Current lifecycle |
| --- | --- | --- |
| GitHub webhook intake | Delivery and event metadata, installation/repository identifiers, a payload SHA-256 digest, bounded normalized lifecycle actions, state, timestamps, and bounded errors. BoardReadyOps does not persist the raw GitHub webhook body. | Successful processing marks the row processed and normalized actions are replaced with an empty array. `BOARDREADYOPS_WEBHOOK_RETENTION_DAYS` defaults terminal metadata retention to 30 days. Bounded cleanup removes only processed, failed, or dead-letter rows after their persisted deadline; accepted and processing rows are not purged. |
| Installation and repository records | GitHub installation/account identifiers and repository identity, visibility, default branch, enablement, suspension, and routing state. Installation or repository scoped. | Retained until an explicit installation/repository lifecycle operation removes the parent record. No customer-facing uninstall export, erasure, or legal-hold workflow is implemented. |
| Logical runs, attempts, transitions, outbox, and reconciliation | Commit/ref/PR metadata, run and attempt state, transition history, bounded side-effect payloads, external results, replay records, reconciliation state, and bounded errors. Repository/run scoped. | No automatic age-based purge is implemented. Child records follow database parent relationships when an authorized parent lifecycle operation is eventually executed. |
| Findings and accepted result payloads | Rule IDs, severities, messages, repository-relative paths, metrics, report links, result digests, and the raw normalized runner result payload accepted by the result contract. Run scoped. | No automatic age-based purge is implemented. The result payload remains available for dashboard, replay, and publication consistency until its parent run is removed by a future retention or erasure workflow. |
| Artifact metadata and report objects | Kind, name, role, byte count, SHA-256 digest, and an internal storage path. Artifact metadata is run scoped; the backing object belongs to the configured artifact driver. | When an artifact set is replaced by a newer accepted result, old metadata is removed transactionally and a durable deletion job is queued when the path is no longer referenced. Local objects are then deleted asynchronously and audited. General age-based artifact expiry is not implemented, and non-local storage drivers do not yet have a physical-deletion adapter. |
| Audit events | Privacy-bounded actor, subject, tenant dimensions, event type, timestamps, and allowlisted metadata. Installation scoped with optional repository/run/artifact/runner dimensions. | Audit events are append-only: direct update and delete operations are rejected. No automatic age-based purge is implemented. Any future erasure or retention procedure must explicitly define which evidence is retained, removed, or protected by legal hold. |
| Runner registrations and routing policy | Runner names, allowed repository scope, public verification keys/fingerprints, capabilities, heartbeat/status data, and installation/repository routing policy. | Retained until disabled or removed by an installation lifecycle operation. Runner private keys are not stored in the control plane. |
| Runner leases, enrollment, upload capabilities, and request nonces | Lease/capability state, public identifiers, timestamps, declared artifact metadata, and SHA-256 digests of bearer values. | Plaintext capability, lease, enrollment, and nonce secrets are not persisted. Individual credentials have expiry or terminal states, but no general age-based row purge is implemented. |
| Artifact deletion jobs | Tenant/run identifiers, storage driver/path, reason, digest, byte count, attempts, lease state, terminal outcome, and bounded errors. | Durable jobs retry transient failures, recover expired leases, and end as completed or dead-letter. Completed rows are retained as operational proof; no automatic age-based purge is implemented. |

## Implemented controls

### Webhook minimization and retention

BoardReadyOps verifies the GitHub signature before normalization. The raw request
body is used for signature verification and digest calculation but is not inserted
into PostgreSQL. Successful processing clears normalized actions immediately.
Dead-letter actions remain available only until the row's configured terminal
retention deadline so operators can investigate or replay bounded lifecycle work.
Changing `BOARDREADYOPS_WEBHOOK_RETENTION_DAYS` applies only to newly accepted rows
and does not rewrite existing `retention_until` values.

### Artifact access and replacement deletion

A dashboard download URL is bound to one run, artifact, and expiry and is accepted
for at most 15 minutes. The route must also find the current artifact metadata,
validate the signature, resolve a regular file inside `ARTIFACT_STORAGE_ROOT`, and
match the stored byte count. Removing artifact metadata therefore makes an old URL
unusable through the BoardReadyOps route even while a physical-deletion job is
pending. Rotating the dedicated signing key invalidates all previously issued URLs.

For a replaced artifact, metadata deletion and deletion-job creation occur in one
PostgreSQL transaction. The worker records `artifact.object.deleted` after the local
object was removed or was already absent; the audit metadata distinguishes
`outcome=deleted` from `outcome=missing`. Unsafe paths, unsupported drivers, and
terminal failures are not reported as successful deletion. This behavior covers
only artifacts replaced by a newer accepted result.

### Tenant scope and auditability

Installations are the top-level tenant boundary. Repository, run, artifact, runner,
replay, reconciliation, transition, and deletion records are validated against
that boundary by foreign keys and scope-validation functions. Operational database
records may contain finding messages, repository-relative paths, and internal
artifact storage paths. Audit exports and worker telemetry intentionally omit raw
source payloads, finding content, artifact names, and storage paths.

## Current gaps

The current release does not provide all lifecycle controls requested by issue
#44. In particular:

- per-organization or per-repository retention settings are not implemented;
- general age-based expiry for runs, findings, accepted result payloads, audit
  events, outbox/reconciliation history, or managed artifacts is not implemented;
- an organization, repository, or user erasure workflow is not implemented;
- an uninstall export and post-uninstall deletion workflow is not implemented;
- a legal-hold workflow is not implemented;
- physical deletion for object-storage drivers is not implemented; and
- backup and platform-log expiry remain operator responsibilities.

Operators must not interpret database cascade relationships as a supported customer
erasure procedure. A future erasure implementation must be tenant scoped, durable,
recoverable, auditable, explicit about immutable evidence, and able to report what
remains in backups or external systems.

## Related operations documentation

- [Cloud control-plane deployment](../deployment/self-hosted.md)
- [Customer self-hosted runner](../deployment/self-hosted-runner.md)
- [Audit logs](audit-logs.md)
- [Threat model](threat-model.md)
