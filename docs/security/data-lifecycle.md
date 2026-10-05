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
operator for standard-trust jobs. Safe-mode jobs always remove their temporary workspace;
`--keep-workspace` is ignored so reduced-trust source cannot be retained by that debug
option. Workspaces should not be included in general-purpose backups.

## Current data lifecycle matrix

| Data class | Stored content and scope | Current lifecycle |
| --- | --- | --- |
| GitHub webhook intake | Delivery and event metadata, installation/repository identifiers, a payload SHA-256 digest, bounded normalized lifecycle actions, state, timestamps, and bounded errors. BoardReadyOps does not persist the raw GitHub webhook body. | Successful processing marks the row processed and normalized actions are replaced with an empty array. `BOARDREADYOPS_WEBHOOK_RETENTION_DAYS` defaults terminal metadata retention to 30 days. Bounded cleanup removes only processed, failed, or dead-letter rows after their persisted deadline; accepted and processing rows are not purged. |
| GitHub Marketplace lifecycle | Delivery ID, stable GitHub account ID, account login/type, optional installation ID, bounded plan metadata, current active/canceled state, and event effective date. The raw Marketplace webhook body is not persisted. | Signed deliveries are recorded idempotently. Current state advances only for non-stale effective dates. Cancellation atomically revokes repository API tokens, removes the account from hosted repository/session views and future control-plane lifecycle enqueue, and queues an account-scoped erasure request (`organization` or `user`, matching the Marketplace account type) with `due_at` 30 days after the cancellation effective date; matching active legal holds mark the request blocked. Erasure execution is currently an operator workflow, not an automatic purge. |
| Installation and repository records | GitHub installation/account identifiers and repository identity, visibility, default branch, enablement, suspension, and routing state. Installation or repository scoped. | A GitHub App uninstall immediately suspends the persisted installation, revokes its repository API tokens, and queues one account-scoped erasure request (`organization` or `user`, derived from the persisted installation) with `due_at` 30 days after BoardReadyOps processes the uninstall. Matching active legal holds make that request `blocked_by_hold`. Webhook replay cannot create a second active uninstall request. Complete erasure execution remains an operator workflow and automatic uninstall export is not yet implemented. |
| Logical runs, attempts, transitions, outbox, and reconciliation | Commit/ref/PR metadata, run and attempt state, transition history, bounded side-effect payloads, external results, replay records, reconciliation state, and bounded errors. Repository/run scoped. | `BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS` defaults completed outbox-effect and completed reconciliation-item retention to 90 days. Bounded cleanup preserves active, dead-letter, and reconciliation-required records. Logical runs, attempts, transitions, and replay operations have no automatic age-based purge. |
| Findings and accepted result payloads | Rule IDs, severities, messages, repository-relative paths, metrics, report links, result digests, and the raw normalized runner result payload accepted by the result contract. Run scoped. | No automatic age-based purge is implemented. The result payload remains available for dashboard, replay, and publication consistency until its parent run is removed by a future retention or erasure workflow. |
| Artifact metadata and report objects | Kind, name, role, byte count, SHA-256 digest, normalized content type, internal storage locator, optional execution-attempt binding, and optional persisted retention deadline. Artifact metadata is run scoped; tenant ownership derives through the run/repository/installation relationship and the backing object belongs to the configured artifact driver. | A durable artifact row is the availability source of truth. Replacement and age-based retention both remove eligible metadata transactionally and queue a durable deletion job only when the locator is no longer referenced. Free defaults managed artifacts to 30 days, Team to 365 days, and Business/Enterprise use an explicit finite tenant policy or persisted artifact deadline before destructive age-based expiry. Active tenant legal holds suppress automatic expiry. The local-storage worker removes backing objects asynchronously and audits deleted/missing outcomes; non-local drivers do not yet have a physical-deletion adapter. |
| Audit events | Privacy-bounded actor, subject, tenant dimensions, event type, timestamps, and allowlisted metadata. Installation scoped with optional repository/run/artifact/runner dimensions. | Audit events are append-only: direct update and delete operations are rejected. No automatic age-based purge is implemented. Any future erasure or retention procedure must explicitly define which evidence is retained, removed, or protected by legal hold. |
| Runner registrations and routing policy | Runner names, allowed repository scope, public verification keys/fingerprints, capabilities, heartbeat/status data, and installation/repository routing policy. | Retained until disabled or removed by an installation lifecycle operation. Runner private keys are not stored in the control plane. |
| Runner leases, enrollment, upload capabilities, and request nonces | Lease/capability state, public identifiers, timestamps, declared artifact metadata, and SHA-256 digests of bearer values. | Plaintext capability, lease, enrollment, and nonce secrets are not persisted. Expired runner request nonce digests are removed periodically in bounded batches after their persisted deadline. Pending artifact upload capabilities are marked expired and unconsumed enrollment tokens are revoked after their persisted deadline in bounded batches. `BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS` defaults terminal artifact capability, consumed or revoked enrollment, and terminal setup-probe metadata retention to 30 days; bounded cleanup then deletes those one-time rows without deleting their durable run, finding, artifact, setup revision, or audit evidence. |
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


### Terminal ephemeral record retention

`BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS` defaults to 30 and accepts values from 1 through 3650 days. Each cleanup cycle derives a cutoff from the current configured value and deletes at most the configured batch size from each terminal scope with deterministic `FOR UPDATE SKIP LOCKED` selection. Eligible rows are uploaded, failed, expired, or revoked artifact upload capabilities; consumed or revoked runner enrollments; and completed, failed, or expired repository setup probes. Pending capabilities, active uploads, unconsumed active enrollments, and pending or dispatched probes are excluded. The cleanup logs only aggregate counts and error classes.

These rows contain one-time capability or probe history, not the durable release result. Their deletion does not remove release runs, findings, artifact metadata or objects, repository setup revisions, runner registrations, or append-only audit events. Changing the setting changes future cutoff calculations and does not rewrite timestamps already stored on rows.

### Completed control-plane history retention

`BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS` defaults to 90 and accepts values from 1 through 3650 days. Each cleanup cycle deletes bounded batches of completed outbox effects and completed reconciliation items older than the calculated cutoff. Completed outbox effects with retained reconciliation references are preserved; dead-letter and reconciliation-required records are preserved, and all available or leased records are excluded. The cleanup logs only aggregate counts and error classes; outbox payloads, external results, tenant identifiers, and reconciliation diagnostics are not logged.

This cleanup removes delivery and reconciliation history only. It does not remove logical runs, execution attempts, findings, accepted result payloads, artifacts, replay operations, transition events, or append-only audit events. Changing the setting changes future cutoff calculations and does not rewrite persisted completion timestamps.

### Artifact access and replacement deletion

A dashboard download URL is bound to one run, artifact, and expiry and is accepted
for at most 15 minutes. The route must also find the current artifact metadata,
validate the signature, resolve a regular file inside `ARTIFACT_STORAGE_ROOT`, and
match the stored byte count. Removing artifact metadata therefore makes an old URL
unusable through the BoardReadyOps route even while a physical-deletion job is
pending. Rotating the dedicated signing key invalidates all previously issued URLs.

A durable artifact row is the availability source of truth. A deployment that cannot mint a signed
download URL does not make that artifact `metadata-only`; it means the access channel is unavailable.
The explicit `metadata-only` runner mode emits no managed artifact row because report bytes are never
uploaded to the control plane. Schema version 39 also records a normalized media type, the execution
attempt when known, and an optional persisted retention deadline. The retention worker enforces that deadline
through the same durable deletion path used for replaced artifacts. When no per-artifact deadline exists, the
tenant managed-artifact policy or plan default determines age-based eligibility.

For a replaced artifact, metadata deletion and deletion-job creation occur in one
PostgreSQL transaction. The worker records `artifact.object.deleted` after the local
object was removed or was already absent; the audit metadata distinguishes
`outcome=deleted` from `outcome=missing`. Unsafe paths, unsupported drivers, and
terminal failures are not reported as successful deletion. The same deletion job and audit contract is also used by age-based managed-artifact retention.

### Age-based managed-artifact retention

Each retention-maintenance cycle performs bounded destructive expiry of eligible managed artifact metadata. A persisted artifact `retention_until` deadline is authoritative when present: a future deadline keeps the artifact out of expiry even when an age-based default would otherwise have elapsed, while an elapsed deadline can make the artifact eligible without an inferred plan default. When no persisted deadline exists, an explicit finite tenant `retention_days` policy applies first, then Free tenants use the documented 30-day default and Team tenants use the documented 365-day default. Business and Enterprise tenants without either an artifact deadline or an explicit finite policy do not receive an inferred destructive default. The Data & Retention settings page exposes this tenant-scoped managed-artifact window separately from deployment-level webhook and control-plane-history retention.

Automatic artifact expiry fails closed around legal holds: any active hold for the tenant suppresses that tenant's candidates. Cleanup is bounded and storage-path aware. Concurrent workers serialize work for a shared storage locator, lock its current metadata references, revoke only eligible artifact rows, and queue physical deletion exactly once when no retained reference remains. A retained shared path produces `artifact.object.deletion_skipped` audit evidence instead. Metadata revocation immediately makes stale BoardReadyOps signed download URLs fail closed because the artifact row can no longer be resolved.

The local-storage deletion worker then removes the backing object asynchronously and records `artifact.object.deleted` with `outcome=deleted` or `outcome=missing`. Unsupported storage drivers and terminal filesystem failures are not reported as successful physical deletion. Backups, copied artifact directories, reverse-proxy logs, and platform logs remain outside this application-level lifecycle and require operator retention policy.

### Run dashboard repository authorization

Public repository run dashboards remain readable from their opaque run identifier. Private repository run dashboards fail closed as not found before findings, artifacts, attempts, or transition evidence is queried. A private run can be loaded only when the calling route supplies explicit repository authorization; the current public run routes do not grant that authorization. This boundary also prevents private runs from minting signed artifact links through an unauthenticated dashboard request.

### GitHub App uninstall intake

The GitHub App `installation.deleted` lifecycle transition is a deny-now/delete-later boundary. BoardReadyOps suspends the installation immediately, so session and API authorization paths stop exposing its repositories, and revokes every active BoardReadyOps repository API token owned by that installation in the same SQL statement. The transition records the existing `github_app.installation.disabled` audit event and creates at most one active `github_app_uninstall` erasure request for the persisted installation tenant.

The uninstall request uses the persisted installation `account_login` and `account_type` rather than trusting mutable webhook display fields. Organization installations receive an organization-scoped request; user installations receive a user-scoped request bound to the persisted login. Its deletion deadline is 30 days after BoardReadyOps processes the uninstall. An applicable active legal hold changes the request to `blocked_by_hold` and records the matching hold identifier. Webhook retries and concurrent delivery replay are deduplicated by both the lifecycle audit guard and a partial unique index over active uninstall requests. A later real `installation.created` event marks any still-active uninstall request `canceled`; metadata refresh events do not cancel it.

This is an intake contract, not automatic purge. The 30-day period gives operators a defined retention window while the existing export/erasure operator workflow remains the execution surface. BoardReadyOps does not yet automatically materialize an uninstall export, purge every relational data class, delete non-local managed objects, or expire backup/platform copies when the deadline arrives.

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

- tenant/organization managed-artifact retention is implemented, but repository-specific retention overrides are not;
- physical age-based expiry for runs, findings, accepted result payloads, audit events, and replay/transition history is not activated; managed-artifact expiry is implemented separately as described above;
- organization, repository, and user erasure **request intake** exists, including a 30-day Marketplace-cancellation deadline, but complete erasure execution across relational data and managed objects is not automated;
- GitHub App uninstall now queues a legal-hold-aware 30-day erasure request and revokes repository API tokens, but automatic uninstall export and complete post-uninstall deletion execution are not implemented;
- tenant-scoped legal holds can be created, released, and enforced against artifact expiry and erasure intake, but complete uninstall/erasure execution across all retained data classes is not implemented;
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
