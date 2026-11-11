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

**Native review visuals:** The CLI option review publish --native-visuals can send KiCad-generated PCB and schematic SVGs to the configured BoardReadyOps server. These derived images can expose substantial customer design IP and are stored as run snapshots. This is disabled by default: metadata-only Review publishing does not turn it on. Enable it only for a trusted self-hosted server or a hosted environment approved to receive proprietary design visuals. Existing run-snapshot retention is not a guarantee of immediate deletion.

### BoardReadyOps control-plane boundary

The control plane stores tenant-scoped metadata in PostgreSQL. Optional managed
report artifacts are stored by the configured artifact driver. The currently
implemented physical deletion worker supports `ARTIFACT_STORAGE_DRIVER=local`.
The `S3ArtifactStorage` interface remains a stub: when `AWS_S3_BUCKET` is
configured, its upload, completion, download, and deletion operations fail
closed instead of silently using a process-local simulated object store.
This is not a real S3/R2 provider adapter or a customer export capability.
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
| Installation and repository records | GitHub installation/account identifiers and repository identity, visibility, default branch, enablement, suspension, and routing state. Installation or repository scoped. | A GitHub App uninstall immediately suspends the persisted installation, revokes its repository API tokens, and queues one account-scoped erasure request (`organization` or `user`, derived from the persisted installation) with `due_at` 30 days after BoardReadyOps processes the uninstall. Matching active legal holds make that request `blocked_by_hold`. Webhook replay cannot create a second active uninstall request. Complete erasure execution remains an operator workflow. The uninstall transition also queues one account-scoped export request for the same persisted tenant; legal holds do not block export intake because export is non-destructive. |
| Logical runs, attempts, transitions, outbox, and reconciliation | Commit/ref/PR metadata, run and attempt state, transition history, bounded side-effect payloads, external results, replay records, reconciliation state, and bounded errors. Repository/run scoped. | `BOARDREADYOPS_CONTROL_PLANE_HISTORY_RETENTION_DAYS` defaults completed outbox-effect and completed reconciliation-item retention to 90 days. Bounded cleanup preserves active, dead-letter, and reconciliation-required records. Logical runs, attempts, transitions, and replay operations have no automatic age-based purge. |
| Findings and accepted result payloads | Rule IDs, severities, messages, repository-relative paths, metrics, report links, result digests, and the raw normalized runner result payload accepted by the result contract. Run scoped. | No automatic age-based purge is implemented. The result payload remains available for dashboard, replay, and publication consistency until its parent run is removed by a future retention or erasure workflow. |
| Artifact metadata and report objects | Kind, name, role, byte count, SHA-256 digest, normalized content type, internal storage locator, optional execution-attempt binding, and optional persisted retention deadline. Artifact metadata is run scoped; tenant ownership derives through the run/repository/installation relationship and the backing object belongs to the configured artifact driver. | A durable artifact row is the availability source of truth. Replacement and age-based retention both remove eligible metadata transactionally and queue a durable deletion job only when the locator is no longer referenced. Persisted artifact deadlines remain authoritative. Otherwise an explicit repository override wins over the tenant policy, Free defaults to 30 days, Team to 365 days, and Business/Enterprise can inherit a tenant policy or use a repository-specific finite/indefinite override before destructive age-based expiry. Active tenant legal holds suppress automatic expiry. The local-storage worker removes backing objects asynchronously and audits deleted/missing outcomes; non-local drivers do not yet have a physical-deletion adapter. Before local filesystem unlink, the worker rechecks its current lease and defers a deletion if a tenant legal hold is active, without consuming the retry budget. The lease-expiry and hold-deferral timestamps in this pre-unlink database statement use the PostgreSQL server clock, not the worker's potentially skewed local clock. Tenant retention policies are matched to GitHub installation logins case-insensitively by both the worker and the read-only preview. If older records contain multiple case-only policy rows, the longest non-null retention period wins to avoid prematurely deleting data until records can be reconciled. GitHub account logins are matched case-insensitively across hold visibility, age-based retention expiry, automatic GitHub App uninstall/Marketplace erasure admission, and this pre-unlink check; case-only login spelling differences must not bypass a hold. User-scoped legal holds also compare the GitHub-login scope identifier case-insensitively; repository scope identifiers retain exact matching. Schema migration 0104 (merged into source `main`) introduces a persisted unresolved-unlink fence plus hold-admission and installation-rename guards, coupled with a pre-unlink database lease/hold check and post-audit settlement. The [hold/unlink safety contract](artifact-hold-unlink-coordination.md) defines its ordering requirements, and [operator recovery and rollout](durable-artifact-unlink-operations.md) states the mandatory quiescing and quarantine procedures. **This source implementation is not proof that all runtime workers have been upgraded or that the safety boundary is deployed**; older unlink workers, external storage access and uncertain object outcomes remain explicit production acceptance gates. |
| Audit events | Privacy-bounded actor, subject, tenant dimensions, event type, timestamps, and allowlisted metadata. Installation scoped with optional repository/run/artifact/runner dimensions. | Audit events are append-only: direct update and delete operations are rejected. No automatic age-based purge is implemented. Any future erasure or retention procedure must explicitly define which evidence is retained, removed, or protected by legal hold. |
| Runner registrations and routing policy | Runner names, allowed repository scope, public verification keys/fingerprints, capabilities, heartbeat/status data, and installation/repository routing policy. | Retained until disabled or removed by an installation lifecycle operation. Runner private keys are not stored in the control plane. |
| Runner leases, enrollment, upload capabilities, and request nonces | Lease/capability state, public identifiers, timestamps, declared artifact metadata, and SHA-256 digests of bearer values. | Plaintext capability, lease, enrollment, and nonce secrets are not persisted. Expired runner request nonce digests are removed periodically in bounded batches after their persisted deadline. Pending artifact upload capabilities are marked expired and unconsumed enrollment tokens are revoked after their persisted deadline in bounded batches. `BOARDREADYOPS_EPHEMERAL_RECORD_RETENTION_DAYS` defaults terminal artifact capability, consumed or revoked enrollment, and terminal setup-probe metadata retention to 30 days; bounded cleanup then deletes those one-time rows without deleting their durable run, finding, artifact, setup revision, or audit evidence. |
| Artifact deletion jobs | Tenant/run identifiers, storage driver/path, reason, digest, byte count, attempts, lease state, terminal outcome, and bounded errors. | Durable jobs retry transient failures, recover expired leases, and end as completed or dead-letter. Completed rows are retained as operational proof; no automatic age-based purge is implemented. |

For historical USER source-class scope and customer-export release gates, see [uninstall export acceptance](historical-user-uninstall-export-acceptance.md).

**Historical USER partial ZIP: durable private disk preflight, NOT
customer delivery (source-only).** The local-only original USER archive
can seal verified v3 partial ZIP in the reserved private directory
with 0700/0600 permissions, no-follow/no-clobber writes, file/directory
fsync, and independent ZIP+SHA verification after reopening. A
private orchestration function revalidates original numeric USER,
physical objects, source snapshot, retention, hold and erasure AFTER
fsync; stale, wrong-owner or unsafe-path results deny. This does NOT
atomically commit DB and filesystem state, provide a complete release
entitlement, or authorize customer download. Failed attempts may
leave unreferenced private bytes requiring audited retention cleanup
before any production rollout. Source-only migration 0124 and a
MANUAL-ONLY cleanup helper now permit deletion of an EXACT original
numeric GitHub USER-bound, immutable, revoked/expired private-preflight
ZIP when its export is FAILED and aged by at least one hour. Legal
hold table/owner row/tenant advisory locks protect against concurrent
writers; running erasure, unsettled reader reservation, active preflight,
wrong owner, invalid mode/inode or tampered ZIP deny cleanup. Exact ZIP
SHA/length come from the immutable DB preflight, never a filename claim.
An append-only deleted/missing audit row is written with the original
user/export/preflight binding. Unknown orphan files are deliberately
quarantined and no background janitor or download endpoint is created.
Source-only migration 0125 now adds durable cross-worker reservations for
the NEW internal private-partial ZIP verifier. Before any private disk
read, the reservation is committed under the original numeric USER,
specific active private preflight and ZIP digest/size; it is explicitly
released AFTER disk+DB source verification, not auto-expired. The manual
cleanup rejects unresolved private ZIP reservations across PostgreSQL
connections, including crashes and revoked exports; it also still
rejects active artifact readers. A database-level export deletion guard
prevents ON DELETE CASCADE from removing an unresolved private ZIP reader;
the guard permits normal deletion only after reader settlement. This is NOT a customer transfer lease,
does not automatically fence every low-level private file read,
and lacks an automatic verified stale-reader recovery workflow.
A new read-only, internal recovery assessment reports unresolved
private ZIP reader counts under the original numeric USER/tenant/hold
transaction gates; for a FAILED aged export with revoked/expired
preflight it also reports the oldest reader start time. It does NOT
include raw read tokens or prove worker death, and its releaseAllowed
and workerLivenessProven flags are always false. The PostgreSQL clock
decides age eligibility, not a potentially skewed operator clock.
No force-release or timed cleanup can be inferred from this report.


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

The GitHub App `installation.deleted` lifecycle transition is a deny-now/delete-later boundary. BoardReadyOps suspends the installation immediately, so session and API authorization paths stop exposing its repositories, and revokes every active BoardReadyOps repository API token owned by that installation in the same SQL statement. The transition records the existing `github_app.installation.disabled` audit event, creates at most one active `github_app_uninstall` export request for the persisted installation tenant, and creates at most one active `github_app_uninstall` erasure request for that tenant.

Both uninstall requests use the persisted installation `account_login` and `account_type` rather than trusting mutable webhook display fields. Organization installations receive an organization-scoped request; user installations receive a user-scoped request bound to the persisted login. Its deletion deadline is 30 days after BoardReadyOps processes the uninstall. An applicable active legal hold changes the request to `blocked_by_hold` and records the matching hold identifier. Webhook retries and concurrent delivery replay are deduplicated by the lifecycle audit guard plus separate partial unique indexes over active uninstall export and erasure requests. A later real `installation.created` event cancels only a still-active uninstall **erasure** request; the paired export request remains available for customer portability. Metadata refresh events do not cancel either request.

**Immutable historical user identity (migration 0115, local source only):**
Signed installation webhooks now retain GitHub's numeric `account.id` when
present, in addition to the mutable display login. A later uninstall of a
`User` installation records this original numeric account ID on its unbound
user-scoped export. If a signed webhook omitted the account ID, the saved
historical export has no independently provable original owner, and it is
not retroactively attributed using username matching. An **internal
metadata-only** read method accepts only a positive immutable user ID
supplied by a separately verified GitHub OAuth/session identity, checks
the original persisted ID, unbound user scope and system uninstall origin,
and rejects completed erasure. A dedicated, read-only Next.js endpoint
(api/v1/historical-user-exports/:exportId) now reads that bounded status
through the server-verified signed GitHub OAuth session's numeric user ID,
without requiring a live/previous installation ID. This response contains
only status, scope, creation/expiry timestamps and downloadAvailable=false;
it never returns tenant login, the old installation, stored signed URL,
archive bytes, or a deletion capability. Unknown URL parameters (including
download=archive and userId), cross-origin requests and Range requests
are rejected. Renamed/recycled logins cannot transfer ownership because
the numeric ID—not a login—is authoritative. The endpoint is not a
customer ZIP recovery capability; actual historical user-scope archive
materialization, expiry, delivery, auditable erasure and production
deployment acceptance remain open. Existing pre-0115 rows without a
numeric owner ID remain quarantined.

An additional **internal read-only historical repository preflight** can now
discover at most 100 retained repositories linked to suspended `User`
installations with BOTH the same immutable numeric GitHub owner ID and the
same original persisted account login. It runs within one bounded
repeatable-read PostgreSQL transaction, excludes mismatched/recycled-login
accounts, denies legacy ownerless exports and completed erasures, and fails
the whole operation on count or byte-budget overflow rather than quietly
truncating. Its SHA-256 JSON result explicitly reports **partial coverage**:
repository metadata only, excluding runs, findings, reviews, artifacts,
audit history, and platform copies. This result is not exposed over HTTP,
does not acquire a claim, stage or publish ZIP bytes, revive an installation,
or mark a customer export complete. A second internal
`prepareVerifiedHistoricalUserRunFindingSnapshot` preflight now reads
retained release-run and finding facts for that same immutable owner and
suspended `User` installations. It independently uses a bounded
repeatable-read transaction, caps runs/findings at 100 rows each and JSON at
256 KiB, rejects mismatched accounts and incomplete/invalid relationships,
and returns a SHA-256 receipt marked `completeCustomerExport=false`.
Those two legacy preflight methods remain independent snapshots and their
digests cannot be combined. A third, internal
`prepareVerifiedHistoricalUserConsistentCorePreflight` now reads retained
repository, run, finding and artifact metadata under **one immutable-owner
gate, one PostgreSQL statement and one repeatable-read transaction**, with
independent 100-row limits per data class and a single 256 KiB receipt limit.
The bounded JSON/SHA-256 evidence validates that all runs belong to the
included repositories, findings and artifact descriptors belong to those
runs, and review/revision run references remain within the same repository.
Repository-linked audit descriptions require matching installation and
repository scope; audit events referring to a foreign review are rejected.
Installation-level audit events with no current repository, release-run or
artifact dimension are now included as separately capped, **non-content**
descriptors, but only for the signed-webhook original numeric GitHub user's
retained suspended installations. This excludes recycled usernames and
unrelated installations, and does not expose the installation ID, actor ID,
subject ID, arbitrary metadata or a download capability. Existing immutable
installation audit rows are included rather than overwritten, and more than
100 matching events fails the entire preflight instead of truncating.
The same original-user repeatable-read transaction now also reports eight
**privacy redaction counts** without copying the underlying audit values:
for installation-only and repository-scoped events separately it counts
events carrying (1) actor ID/login, (2) subject ID, (3) request ID and
(4) nonempty arbitrary metadata. Counts are bounded by each verified
event class's actual size (maximum 100); invalid, missing or extra count
fields invalidate the archive preflight. Descriptors explicitly set
actorDetailsIncluded, subjectDetailsIncluded, requestIdIncluded and
metadataIncluded to false. Only fixed safe actor classes (system, GitHub
webhook, internal, guest, runner) are displayed; other actor_type values
from the generically validated DB column become redacted rather than
potentially leaking a custom human login. A second independent ZIP parser
rejects extra identity/metadata properties on audit events, unknown actor
classes, or orphaned/foreign repository/run references even if the ZIP
digest was recomputed. The counters are privacy accounting, **not** a
release of third-party actor identities or proof that a private audit
record may be shown to another person.
The same consistent snapshot now includes **bounded original-owner review
collaboration content**, not just metadata descriptors. It retains review and
repository links, comment parent-chain integrity, status and completion flags,
comment text and optional evidence anchors/fingerprints, approval reason and
invalidation reason (plus break-glass boolean), and checklist titles. Each
class has an independent 100-row cap; comment text, reasons and titles have
8 KiB UTF-8 ceilings, and evidence anchors/fingerprints are separately
bounded. An oversized Unicode string, foreign repository, orphaned/cyclic
comment parent, missing/mismatched approval revision, or row/JSON budget
overflow fails the entire snapshot closed. Ownerless exports, recycled logins,
completed erasures and invalid references also fail closed.

The same repeatable-read, numeric-original-USER-gated snapshot now covers
**finding decision history and assignment descriptors** linked to those
reviews. Decisions include the finding fingerprint, disposition, bounded
reason (4 KiB UTF-8), evidence digest and optional expiry. Assignment
descriptors include finding/review/repository relationships, but intentionally
not assignee or assigner identities. Decision owners and actors are likewise
omitted. Each class has a separate 100-row hard cap; mismatched repository
IDs, oversized reasons/fingerprints, duplicate IDs, or any overflow fail the
entire preflight closed. The independent partial ZIP verifier also checks
finding-to-review ownership, allowed dispositions, and absence of person
identities when extracting the historical core metadata.

**Excluded original-USER data-class evidence (source-only):** the same
immutable numeric GitHub USER-gated, repeatable-read historical core now
counts five additional sensitive classes **without copying their payloads**:
`run_snapshots` (rendered proprietary PCB/schematic design content),
`api_tokens` (names, prefixes, hashes, scopes and creators),
`runner_registrations` (host identity and fingerprints),
`installation_component_credentials` (encrypted provider credential
envelopes), and `installation_component_observations` (licensed per-tenant
component intelligence). Counts are joined strictly through the original
suspended installation's numeric account identity or its retained
repositories/runs, never a recycled GitHub login. Each count is bounded to
100; 101 or any invalid class/count shape rejects the entire source-only
preflight rather than silently presenting truncated data. The private
partial ZIP verifier requires the exact five-class count set and exclusion
labels; it does not include the sensitive underlying rows. This is a
**coverage gap inventory**, not the missing classes being exported.

**Private visual integrity boundary (separate source-only preflight):**
`prepareVerifiedHistoricalUserPrivateVisualEvidence` now performs an
independent repeatable-read, original-numeric-GitHub-USER-scoped check of
retained `run_snapshots`. It reads up to 100 rows internally, verifies
each bounded SVG's stored SHA-256 against its actual UTF-8 content, and
returns **only** a digest-checked manifest of database row UUID, owned run/
repository, visual kind/format, SHA-256 and byte length. It never returns
SVG content, original sheet-derived snapshot ID, name, anchors, URL or a
renderable file. Limits: 256 KiB per visual, 4 MiB total input and 100 rows.
A digest mismatch, unsupported PNG/WebP record, oversized SVG, incorrect
ownership or overflow fails the entire preflight. Synthetic PostgreSQL
tests exercise original-owner/recycled-login isolation and all these
failure cases. The **source-only partial ZIP v3** now includes the
**content-free original USER visual evidence manifest** beside the core
metadata and SHA-verified physical objects. Its deterministic receipt binds
every entry by exact length and SHA-256, records the private visual descriptor
count, and explicitly excludes visual content. The independent ZIP verifier
rejects missing, foreign, malformed or count-inconsistent evidence, even
when the full ZIP hash and receipt are recomputed. A **strict, deny-by-default
historical core privacy schema** now separately restricts ALL top-level JSON
keys, every source-class row's allowed fields, and the EXACT 15 source
exclusion labels. Previously unknown extra fields could pass some partial
core checks even after a recomputed ZIP receipt; those now fail closed.
Specific disclosure flags must be fixed: private review author/approval/
completion identities remain excluded, visual SVG content remains excluded,
and unverified artifacts never become downloadAvailable or contentsVerified.
For any future data-field expansion, the source exporter and independent
ZIP verifier must both change intentionally with fresh privacy tests.
Adversarial tests add raw token, third-party author/approval identity and
artifact download flags, plus a fully rehashed ZIP whose core contains a
private OAuth-token-shaped field; all are rejected before private staging.
**Approved field shape is not legal authority to disclose any third-party
review content, private design metadata or platform source.**

During private archive preparation, the original numeric USER's core
metadata **and** private visual evidence now share **one REPEATABLE READ READ
ONLY PostgreSQL transaction**, so a concurrent new or edited visual cannot
produce one core count from an earlier snapshot and a visual manifest from a
later snapshot. The pair is reread in another single consistent transaction
after disk IO, while all physical copy reservations remain active; exact
byte-for-byte initial/final equality is required. With both digests supplied,
the source-only checked-write gate also rereads a **coherent core+visual pair**
before and after its awaited callback. Physical files are still checked
outside the database transaction. Different BEGIN/COMMIT boundaries across
initial/core+visual, final/core+visual and guarded transport checks remain.
Additive local migration **0118** now maintains a transactionally incremented,
original-installation-specific revision for committed **review row changes,
private run_snapshots changes, and append-only audit event insertions**.
Additive local migration **0119** extends the same transactional epoch to
review revisions, comments, approvals, checklist items, finding decisions
and finding assignments, using the true parent review -> repository ->
suspended original USER installation. A different numeric GitHub USER
reusing the same login does not affect the original user's fingerprint.
Additive local migration **0120** covers the four further source classes
ACTUALLY included in the partial core: repositories, release runs, findings
and artifacts (including artifact metadata/retention updates). One shared
owner-scoping trigger derives the real installation directly for repositories,
through repository FK for runs, and through run/repository FKs for findings
and artifacts. Successful INSERT/UPDATE/DELETE operations advance the same
transactional original USER revision; cross-owner run/finding/artifact
reparenting accounts for old and new scopes in deterministic key order.
A synthetic recycled-login foreign GitHub numeric user does not change the
original owner's epoch, while moving a finding out and back advances both.
Each core+visual consistent snapshot also captures an original numeric-USER
scoped SHA-256 fingerprint of these counters (no installation names, design
content, or raw audit identities). The **partial ZIP v3** receipt binds this
fingerprint, and its private assembly and optional guarded-write checks
compare it across the initial/final and before/after reads. Committed
edit-restore (ABA) on tracked review, collaboration, visual and audit classes
is detected even when content hashes revert; rolled-back writes do not
advance the revision. The tracked core is now more complete, but original
installation ownership/suspension, tenant-only policy or billing records,
retention rules, unmodeled data classes, and filesystem contents can still
change outside a common durable revision/lock protocol, so **full-archive
ABA safety remains unresolved**. It is not a signed/secret-authenticated
receipt or a durable customer download authorization. The SVG bytes are
integrity checked but **not included or rendered**. This is neither browser SVG safety nor customer delivery authority,
a complete export, or legal-hold erasure acceptance. Future opt-in disclosure
and active-content neutralization require a separate policy and test contract.

Other records keyed **only by tenant login** (for example
`review_policy_audit_events`, billing or workspace membership evidence)
cannot be safely attributed to an immutable historical numeric GitHub USER
after account/login reuse. Their inclusion requires a separately audited
ownership and privacy decision; do not join them by login and claim complete
customer export. Actor identities and audit JSON can also contain other
people's personal or privileged data; never blindly copy them into the ZIP.

**Privacy limits remain explicit:** review comment author IDs, approval actor
identities, checklist completion actor identities and arbitrary audit metadata
or subject IDs are NOT included. Only original-user-gated, owner-retained
content is assembled internally; no public endpoint exposes these bodies.
Artifact metadata includes declared SHA-256, size, content type and
retention-expiry status but **no internal storage paths or file bytes**;
`contentsVerified=false` and `downloadAvailable=false` explicitly deny
byte integrity or downloads in the metadata-only snapshot. Full audit
payloads, the separate managed artifact physical byte gate and platform
copies remain excluded from the core snapshot.

A separate internal original-USER artifact byte-integrity preflight now
requires the verified numeric GitHub user, pending historical uninstall request,
suspended matching user installation and retained repository, explicit
future artifact retention deadline, and no completed erasure or queued physical
deletion. Its additive SQL admission uses the existing cross-tenant tenant/path
advisory locks and durable export-copy reservation to prevent an unlink race;
verified local bytes are checked against stored size and SHA-256, with owner,
artifact metadata and retention rechecked both before and after disk IO.
An uncertain reservation release fails closed, leaving the path quarantined.
Other storage backends, expired/unknown retention and revoked requests deny
the preflight. This is **internal source-only integrity testing**, not an
independently authorized customer download, full historical export,
public endpoint or production worker. The new migration installs an
inactive-by-default read-admission primitive; no new scheduled task is started.

An independent, **internal-only partial historical ZIP assembly** now combines
the original USER's single consistent, immutable-owner-gated metadata preflight
with **every** matching, independently verified unexpired local artifact.
Missing, duplicated, foreign, expired, out-of-scope or SHA-mismatched objects
reject the entire assembly; it never silently omits one of the snapshot's
artifacts. The 64 MiB / 100 object limits, fixed ZIP timestamp, private
manifest, per-entry SHA-256 receipt and independent trusted ZIP digest
verification use the established local ZIP and archive-sanitizer primitives.
The receipt is explicitly `completeCustomerExport=false` and has a different
partial-only scope to prevent confusion with the existing claimed customer ZIP.
It separately reports the core JSON's metadata-only exclusions and the count
of physically verified objects present in the ZIP; those metadata exclusions
must not be misread as a claim that the ZIP omits its verified artifacts.
All intended local artifact references are checked against the first owner
snapshot, with the combined expected byte budget capped **before** filesystem
IO. The copy reservations for *every* artifact are now admitted together in a
single read-committed PostgreSQL write transaction, with physical paths
acquired in deterministic order. An unavailable, foreign, already deleting or
otherwise stale object rolls back the **entire batch**, leaving no partial
admission. Once committed, every active durable reservation blocks cooperative
physical unlink workers on its path, **including after that file's own bytes
have been read**, until the final SHA-verified ZIP is assembled or rejected.
Object authority/retention is rechecked on both sides of each individual
physical read, and the original USER's consistent core snapshot is checked
again afterward. A mismatch rejects the entire preflight. Every reservation
is settled in a finally path, attempting the remaining releases even if a
prior one fails; uncertain settlement fails closed and quarantines that path.
Disposable PostgreSQL tests include simultaneous two-path reservations and
all-or-nothing second-object failure.

**Internal prepublication eligibility gate:** once the in-memory ZIP has
passed its independent digest checks and while every physical-path reservation
is still active, a short read-committed PostgreSQL transaction revalidates the
original immutable numeric USER ID, signed-uninstall export status/expiry,
all suspended original-user installations, and an **exact full artifact
manifest** (IDs, run/repository, path, bytes, SHA-256 and retention deadline).
It rejects missing/extra objects, any queued or unresolved physical deletion,
running/completed non-dry-run account- or matching repository-scope erasure,
and artifacts whose retention deadline is within one minute of the database
clock. The original export and installation rows are locked; a NOWAIT SHARE
table lock prevents concurrent legal-hold writes during this short check.
An active hold returns a *manual review required* outcome, not permission to
deliver and not a legal determination that exports are prohibited. Concurrent
hold writers or contended row locks fail closed as busy. Once verified, the
check returns only an internal readiness state: it creates **no durable
publication claim, customer entitlement, URL or audit of delivery**.

**Source-only transfer-time concurrency acceptance:** the same original-user
eligibility check now exposes an *internal test-only awaited operation* that
runs strictly within its established PostgreSQL transaction. The original
request and installation row locks and the legal-hold writer table lock remain
held until this awaited operation finishes or fails. Additive source-only
migration **0117** also establishes a case-insensitive, **tenant-scoped
PostgreSQL advisory lock**. It is acquired by the checked historical USER
transfer *before* re-reading active erasure requests and the complete artifact
manifest. Database triggers require erasure INSERT/UPDATE/DELETE, artifact
INSERT/reparent and **physical deletion-job INSERT/repath** operations
for suspended User installations to participate in the same tenant lock.
This closes new erasure/artifact/deletion-queue phantom gaps during a
checked, awaited transfer operation **without table-locking other tenants'**
artifact, erasure or deletion-queue writes. Two further source-only
triggers serialize original suspended USER `audit_events` INSERTs and
`reviews` INSERTs / repository reparenting with the same tenant lock.
Reparenting obtains the former and new tenant keys in sorted order, so a
review cannot silently leave the original owner's scope while its
bounded transfer is admitted. An unrelated tenant's audit INSERT remains
writable. Existing audit UPDATE/DELETE append-only rejection is unchanged.
All triggers also apply to raw SQL writers and have a bounded 5-second
lock wait; production migration and worker compatibility remain unverified. Existing
artifact changes remain protected by the individual FOR SHARE row locks.

Disposable PG17 tests prove concurrent export revocation, legal-hold INSERT,
same-tenant new erasure (case-insensitive account login), pending-to-running
erasure transition, new artifact insertion, and direct-SQL physical deletion
queue admission cannot complete during the admitted operation. Other tenants'
erasure intake and artifact ingestion continue. A retention-style writer that
already holds an artifact FOR UPDATE row lock cannot deadlock this gate:
its per-row FOR SHARE NOWAIT rejects the check as busy, releases the advisory
lock, and allows the writer to enqueue normally. The following check sees
that new deletion job and rejects delivery. A disconnected/synthetic failed
sink also rolls back and releases locks. A separate **localhost Node HTTP**
test writes one bounded chunk with the existing private ZIP sink, revokes the
original export request
between chunks, and proves the second write callback is never invoked.
This is **not an exposed historical download route** and does not authorize
transmitting the partial ZIP. Only a future session-authenticated handler that
validates an independently bound *complete* sealed ZIP and its immutable
receipt could use bounded transport operations, with explicit audit and
revocation/expiry decisions. A chunk already accepted by the OS cannot be
retracted; additional erasure/retention mutations or inserted artifacts
between checks require rejection of subsequent writes. The internal gate
now also accepts the original **PARTIAL core SHA-256 and exact byte count**
from the private ZIP receipt as an optional trusted input. With this binding,
it independently rereads the original numeric-USER scoped repeatable-read
audit/review core both **before and after** an awaited bounded write. A
new audit/review record committed **between** checked chunks, or a review
title/status, revision, comment, approval or finding collaboration change
that changes the serialized core, rejects the next write. When supplied by
ZIP v3, the original-user private visual evidence SHA-256, byte length
and record count are also checked before and after the bounded callback.
A core or visual edit during
a callback fails the post-write check, but any OS-accepted bytes cannot be
recalled. Original USER mutation stamps in local migrations 0118, 0119
and 0120 detect committed edit-and-restore ABA for enumerated review,
collaboration, visual, audit, repository, run, finding and artifact metadata. Remaining untracked classes still admit ABA,
and the separate metadata read is not atomic with the artifact/legal-hold gate:
a complete sealed, append-safe delivery claim still does not exist.
The earlier source-only public-route prohibition remains; the historical
ZIP is a private partial preflight and MUST NOT be published. Do not
use a detached Promise or an unbounded transport callback while a
PostgreSQL lock is held.

**Source-only private delivery preflight rehearsal (additive local 0121, NOT
a customer delivery grant):** A bounded PostgreSQL row now records only the
immutable numeric original GitHub USER ID, original export ID, supplied private
candidate ZIP SHA-256 and length, exact original-USER core/visual/mutation-epoch
hashes, creation/expiration timestamps, and an irreversible revocation stamp.
Its maximum lifetime is **10 minutes**, and only one candidate may be staged
per original export. Stage and inspect independently check the actual current
original-user core/visual/epoch hashes, pending export ownership and suspended
USER installation, active legal holds, and real running/completed erasure
requests. A committed edit-and-restore ABA of a tracked data class makes the
candidate stale even if its core/visual content returns to the original hash.
The private verified original USER physical-byte partial ZIP v3 stage
and inspect entrypoints now ALSO enforce the canonical short
prepublication PostgreSQL admission gate. They independently match each
current retained artifact's run/repository relationship, SHA-256 and
byte length to the verified actual ZIP's core, then check the FULL
original-USER artifact manifest, pending/authorized export, active
legal hold, applicable erasure, deletion queue/unlink fence, safe
retention, core+visual digests and owner mutation epoch under DB locks.
Even a valid, unchanged ZIP becomes STALE if its original artifact
storage path is newly queued for deletion without any core SHA change.
A local PostgreSQL test stages, inspects, queues deletion, observes
staleness, removes the job and rechecks; unsafe imminent retention
also fails. This is NOT customer access or a durable stream-long lease.

Immutable private staged/revoked event records make transitions auditable without
saving any raw archive, actor identity, bearer token, IP address or delivery URL.
Direct selective preflight/event deletion or re-enabling after revocation is
denied; lawful deletion of the original export cascades its bounded preflight
history. Both `customer_delivery_allowed` and `complete_customer_export`
are permanently **FALSE** by CHECK constraints. The caller-supplied ZIP digest
is a **candidate value**, not proof of an authentic, complete signed ZIP.
There is NO customer-facing route, stream, worker, delivery capability or
secret. These short database state checks DO NOT hold a persisted lock through
network transmission and CANNOT revoke bytes already sent; full in-flight
cooperative cancellation, privacy approval and durable real delivery entitlement
are still unimplemented. Migration 0121 is not deployed.

**Early original USER source-read and physical locator authority (source-only):**
The common numeric GitHub USER PostgreSQL source-owner gate now refuses
expired-but-pending exports, ANY active legal hold in the owner's tenant,
and non-dry-run running/completed erasure before exposing repository
inventory, run/finding snapshots, the consistent historical core, private
visual metadata or combined preflight. The independently authorized
physical artifact locator imposes the same rules before returning even
a storage path (including repository-scoped running/completed erasure).
Dry-run erasure is nonblocking. Export **request intake** following
uninstall remains non-destructive and permitted during a hold; only
private source materialization is withheld. A later locked manifest and
transfer admission remains necessary; these early reads are NOT proof
of comprehensive source coverage, lawful IP/third-party disclosure
rights, or authenticated customer delivery.

**Original USER metadata-only final DB admission gate (source-only):**
The private three-file metadata-only ZIP builder now enumerates *all*
original numeric-user-scoped retained artifact database locators (not
physical file bytes) and compares each ID, run/repository relationship,
SHA-256 and byte length to the consistent core. Immediately after
constructing and independently verifying its ZIP, it invokes the same
short PostgreSQL original USER prepublication gate used by the physical
partial ZIP: the original requester/export must still be pending and
authorized; active legal holds, running/completed applicable erasure,
missing/queued artifacts, unsafe retention, changes to the full managed
artifact manifest, and core/visual/mutation epoch drift fail closed.
A live PG17 negative test exercises active holds, status revocation,
repository-scoped erasure and imminent retention, then confirms recovery
only when those blockers are removed. No physical bytes are read, no
customer entitlement is granted, and these short row/table locks DO NOT
constitute a durable archive seal, authenticated customer delivery lease
or stream-long revocation. The private archive must remain NO_GO.

**Private metadata-only identifier exposure inventory (source-only):** The
internal `assessHistoricalUserMetadataExposure` diagnostic verifies the
exact three-entry metadata-only ZIP, then returns ONLY fixed identifier,
commit/fingerprint, artifact digest/size and visual digest categories with
bounded numeric row counts. It never copies IDs, hashes, raw metadata,
archive fingerprints, export IDs or stored artifact bytes into its result.
All rights checks remain false and the decision is always `NO_GO`.
A recomputed ZIP hash establishes neither original GitHub USER ownership
nor legal data/IP disclosure rights: authenticated current-owner database
checks and complete-source provenance remain separate, mandatory gates.
The result is never exposed through a public HTTP endpoint.

**New, separate SOURCE-ONLY original USER metadata-only ZIP:** Internal
prepareHistoricalUserMetadataOnlyArchive (and its numeric-owner DB-backed
diagnostic) produces exactly three files: strict redacted historical-core
metadata, content-free private visual metadata and a distinct v1
metadata-only receipt. It NEVER accepts a storageRoot, physical object list
or raw artifact bytes; source artifacts appear only as bounded descriptors
and SHA/size fields. The independent verifier checks the exact three paths,
per-entry SHA-256 and lengths, original export ID, fixed exclusion labels,
artifact descriptor count, visual count and mutation-epoch-shaped digest.
It rejects a fourth objects/ entry or reintroduced private metadata even
when every ZIP/receipt hash is recalculated. The existing physical-byte
partial ZIP v3 is deliberately unchanged and MUST NOT pass the metadata-only
verifier, or vice versa. The DB-backed variant uses the original numeric
GitHub USER composite preflight twice and fails closed on mismatched
snapshots, but does NOT lock a consistent source during customer transfer.
SHA-256 of an entirely self-supplied ZIP is NOT a trusted signature or
right to disclose; raw artifact data, even if omitted here, still needs
ownership/IP clearance. No HTTP endpoint, persistent customer ZIP, token,
stream, release, delivery entitlement or legal hold exemption exists.
Both variants remain incomplete, unpublishable private diagnostics.

**Source-only default-deny human text for historical partial ZIP v3:**
The verified original numeric USER core builder now intentionally retains
review/finding row IDs, relationships and non-text evidence descriptors but
**never embeds** six unverified free-text surfaces: finding messages,
review-comment bodies, approval reasons and invalidation reasons, checklist
titles, or finding-decision reasons. In the bounded core these fields are
empty strings or null and comment/checklist inclusion flags are always false.
The original PostgreSQL rows remain unchanged for lawful retention and
future rights determination; this is ONLY an export-view reduction, not
erasure. The independent ZIP verifier demands the same redacted values and
the fixed unverified-collaboration-and-finding-free-text exclusion marker,
rejecting even a recomputed receipt/ZIP SHA that injects the text again.
A zero **included** text count does NOT mean a zero **source** text count;
the diagnostic explicitly reports source_text_disclosure_disabled_by_policy
and still returns NO_GO. This narrow protection does NOT authorize release
of arbitrary artifact bytes, review/repository titles, file paths, opaque
finding references, other metadata or third-party IP.

**Additional identifying metadata reduction (source-only):** The original
numeric USER private partial core also redacts the retained repository
owner/name, run branch ref, finding file path, artifact name, review title
and review-comment evidence anchor to empty/null fields. Original source
tables remain untouched. The independent partial ZIP verifier requires these
exact placeholder values and the fixed exclusion marker
unverified-repository-review-and-artifact-identifying-metadata, denying
recomputed ZIPs that reintroduce private labels. Opaque numeric GitHub
repository IDs, run commit hashes, finding fingerprints, file-content
digests and actual verified artifact bytes may still identify sensitive
resources. The private diagnostic separately emits
unverified_physical_artifact_content_rights when a physical artifact is
included; the archive is still NOT publishable, and neither a verified
SHA nor a private ZIP authorizes delivery of its raw bytes.

**Signed recent GitHub USER identity for PRIVATE historical preflight:**
A source-only internal adapter can now accept the same-server HMAC-verified
GitHub OAuth session cookie, requiring a valid session issued within five
minutes and deriving original owner identity exclusively from the
immutable numeric user ID. It cannot trust a recycled login or old
installation list. Private staging, inspection and one-way revocation
still recheck actual ZIP bytes and canonical database source/hold/erasure
admission; the database keeps customer delivery permanently false.
A recent signed cookie is NOT live GitHub OAuth credential revalidation
or customer delivery authorization. There is no historical customer
ZIP endpoint or downloaded artifact under this code path.

**Optional live GitHub USER OAuth step-up for private stage (SOURCE-ONLY):**
The private historical partial ZIP can now be staged behind an
independent live authentication primitive that requires a valid recent
server-signed session, export-bound OAuth callback state and newly
exchanged authorization code. The GitHub /user numeric ID is compared
against that signed session before the canonical original-user DB/ZIP
manifest/hold/erasure gate runs; a recycled login or stale browser
cookie alone cannot satisfy the live step-up. Access tokens are not
stored. A source-only browser round-trip now has a feature-flagged
historical start route and a separate branch on the EXISTING GitHub
callback. The default-OFF route requires recent signed original numeric
USER identity and an existing pending export, mints a five-minute
HMAC-signed export/nonce/user/time-bound challenge plus separate
`__Host-` state cookie, and clears both cookies on EVERY callback
outcome. A signed challenge is checked before any GitHub call, including
manual Cookie replay. Additive PostgreSQL migration 0122 now stores only
a domain-separated SHA-256 digest of the random OAuth state, bound to
the original numeric USER and pending historical export, with an
immutable five-minute expiry and one-way consumed timestamp. The
callback atomically consumes the nonce BEFORE GitHub code exchange,
so concurrent or repeated callback attempts cannot reuse it, even
if the provider fails. Active tenant legal hold and real erasure
block issuance/consumption, and a dry-run erasure does not. OAuth nonce registration/consumption
now reuses the historical original USER preflight lock order: legal-hold
table SHARE NOWAIT, owner export/installation row SHARE NOWAIT and
nonblocking tenant advisory lock shared with erasure writers (0117).
The locks and final hold/erasure recheck are confined to a bounded
PostgreSQL transaction; no lock spans GitHub HTTP or streaming. Uncommitted
legal-hold INSERT and running-erasure writer races are explicitly tested
and fail closed. Challenges are retained until the original export is
lawfully removed; no plaintext nonce, code or user access token is stored.
Source-only migration 0123 adds an export/time index for bounded
challenge registration: 24 in a rolling five-minute window and 128
over one export's lifetime. Consumed and expired attempts remain in
the durable audit and cannot bypass the limits. The historical USER
tenant advisory lock serializes these quota checks and insertion
across web workers; exceeding a limit denies before GitHub redirect.
This is NOT a customer delivery authorization. A successful callback redirects to dashboard
status only and never stages a ZIP, issues a customer capability or
refreshes the login session. Customer delivery still requires lawful
complete source/IP rights, signed cross-store provenance and stream-
long revocation/hold/erasure/cancellation acceptance.

**Source-only original USER disclosure readiness diagnostic:** The private
`assessHistoricalUserPrivateArchiveDisclosure` function accepts only actual
bounded partial ZIP v3 bytes and the expected export ID. It independently
verifies the entire ZIP and its strict core/privacy schema before returning
a bounded report of 13 source-class row counts, six selected non-empty text
surface counts, sensitive excluded-record counts and redacted-audit-field
counts, plus fixed machine-readable blocker codes. Format v2 also
provides six explicit source-text acceptance rows: author provenance,
lawful third-party disclosure basis, and sensitive-content review are all
NOT VERIFIED and disclosure is FALSE. Eight independent customer-delivery
acceptance rows remain NO_GO until external source inventory, original-owner
provenance, third-party rights, private design/IP rights, lawful exclusions,
durably sealed file/DB snapshot, authenticated expiring delivery and in-flight
revocation/hold/erasure/disconnect E2E evidence exist. Neither an empty
archive nor a self-consistent ZIP can mark any criterion verified. It returns NO repository
names, requester/actor IDs, comments, approval reasons, finding messages,
private visual source or token material. Every valid report explicitly says
`privateDiagnosticOnly=true`, `completeCustomerExport=false` and
`customerDeliveryReady=false`, **even when all counts are zero**.
An empty archive or a self-consistent ZIP with arbitrary collaborator text
does NOT authorize customer delivery or legally clear text disclosure:
rights to third-party review content, private design IP and tenant/platform
records remain unverified. Malformed or owner-inconsistent ZIPs fail closed.
This diagnostic does not consult live PostgreSQL, grant a license, perform
legal classification or override any hold/erasure rule; the existing
numeric-original-USER DB-bound preflight is still separate and private.

**Verified-byte private staging boundary:** Trusted web orchestration now
uses `stageVerifiedHistoricalUserPrivateArchivePreflight` and
`inspectVerifiedHistoricalUserPrivateArchivePreflight`, not an untrusted
caller-supplied archive SHA. Each accepts the actual bounded, in-memory
historical ZIP v3 bytes, computes its SHA-256, invokes the independent partial
ZIP verifier (ZIP paths, integrity receipt, core, content-free visual manifest
and exact physical artifact byte hashes), and derives the stored core, visual
and original-USER epoch fingerprints from those same verified bytes.
The lower private database helper separately compares all fingerprints to
the current immutable numeric original USER's snapshot and rechecks the
pending/held/erasure state. A malformed ZIP, a corrupted compressed metadata
payload, wrong export ID, forged actual archive contents, and even an internally
rehashed ZIP with an invented but format-valid mutation epoch are rejected
in disposable PostgreSQL tests. The low-level database fingerprint API
remains an **internal trusted primitive**, not permission to accept an
unverified digest from an HTTP/client request. The verified ZIP bytes are
neither persisted nor delivered by this new interface. This is still an
**unpublished, partial preflight**, not a signature by an external issuer or
an authorization to disclose a complete archive. The check's distinct
transactions and lack of a durable in-flight send lock remain open work.

**Important publication boundary:** batch copy reservations serialize only
cooperative **physical unlink admission**. They do not pin export request
status, legal holds, retention policy or database rows over the whole
multi-file workflow, and there is no transaction-wide customer publication
fence. The new eligibility transaction briefly holds row/table locks, but
those locks **end at transaction commit**; any authorization, hold or erasure
change after the check still requires independent legal-hold-aware delivery
gating. Even a matching final metadata
snapshot is **not** atomic customer publication authority. The ZIP remains
an in-memory, non-persisted test artifact; customer delivery and real
in-flight network revocation, full private audit payloads, platform erasure,
and an enabled historical worker are still absent. The isolated source-only
0121 private candidate is **not** a delivery lease.

The original consistent core snapshot remains a **partial internal metadata
preflight**, and the separate physical read preflight remains source-only;
neither is a complete customer export, claim, downloadable ZIP, or public API. Publication and
destructive operations remain disabled until
full coverage, retention, original-user authority and legal-hold checks
are independently accepted.

This is an intake contract, not automatic purge. Export request intake is automatic and is intentionally not blocked by legal hold; export pack materialization/download expiry still use the existing export operator/executor workflow. The 30-day period applies to destructive erasure, which remains legal-hold aware. BoardReadyOps does not yet automatically purge every relational data class, delete non-local managed objects, or expire backup/platform copies when the deletion deadline arrives.

**An organization-wide erasure request overlaps every active legal hold within
its tenant**, including repository- and user-scoped holds. The request is recorded
as `blocked_by_hold` even if no organization-scoped hold exists. This applies to
manual intake, GitHub App uninstall, and GitHub Marketplace cancellation.
A narrower
repository or user erasure request still checks organization holds and holds
matching that narrower scope; another tenant's holds cannot block it. These are
intake-time safeguards, not a completed erasure executor. Any future executor
must independently recheck overlapping holds before destructive work.

**Legal-hold release is not erasure resumption.** Releasing a hold deactivates only that hold and records who released it. Requests already marked `blocked_by_hold` remain blocked; release does not automatically requeue them, change their deadlines, or initiate deletion. A supported requeue operation is not implemented. Before one can be introduced, it must require an explicit, audited, tenant-authorized action against a selected request, atomically recheck scope and all overlapping active holds, and retain export and reinstall-cancellation evidence. Operators must not treat release as authorization to purge.

### Tenant scope and auditability

The direct lifecycle endpoints `POST /api/v1/data-exports` and
`POST /api/v1/erasure-requests` require an internal `installationId` in the
JSON body. `GET /api/v1/data-exports/:exportId` requires the same identifier in
its query string and returns metadata, not a signed archive. For each request the
server resolves that GitHub App installation against the current authenticated
viewer's active authorized installations; an absent identifier returns 400 and
a foreign or disabled installation returns 403 without writing a request.
The status read also checks the persisted live installation and the exact
repository scope in SQL: a different installation with the same tenant login,
a suspended installation, or a disabled repository cannot read that request.
Historical unbound organization/repository requests are not assigned an
installation by guessing; legacy unbound user-scoped status remains available
for compatibility but creates no preparable/downloadable package.
The persisted tenant is the resolved installation's account login, not the
human operator's personal GitHub login. Direct organization/repository export
intake is additionally bound to that persisted installation and checks current
repository ownership and enablement in SQL. The resulting pending record can
enter the existing claim-based read-only preparation flow; this does **not**
automatically generate, complete, or deliver a downloadable archive. Legacy
user-scoped export intake remains pending but is not supported by the bounded
repository-metadata manifest preparer. Uninstall export intake for suspended
installations is also separate and must not reactivate access.
These are intake and status endpoints, not export materialization or deletion
executors.

An **operator-only, unexposed preparation stage** can now persist a verified,
allowlisted, repository-metadata manifest of at most 64 KiB in the existing
PostgreSQL export row while a valid installation-bound preparation lease is
held. It verifies the stored SHA-256 by reading the persisted bytes back under
the same live lease. The export **remains running**, not completed; no
customer download URL, delivery capability, auto worker or data deletion is
created. Staged or expired claims are not automatically released or reclaimed;
manual audited recovery and explicit deliverability/expiration validation
are prerequisites for any future complete customer data export.

A **metadata-only preview** can be explicitly published by the current internal
preparation worker while its original lease remains valid; it is not dispatched
automatically. This opens a single 15-minute availability window for the
bounded, SHA-256-verified repository metadata manifest already stored in
PostgreSQL. Only the signed-in user who originally requested the export, with continuing installation access, may retrieve it via
GET /api/v1/data-exports/:exportId?installationId=:id&download=metadata-manifest.
Every read rechecks the persisted live installation, repository enablement,
expiry, revocation and content integrity; responses have private/no-store,
no-sniff and attachment headers. The original human requester may revoke
access with a same-origin DELETE on the export status URL. Expiry and
revocation do not automatically delete retained preparation bytes, and do not
authorize a fresh worker claim. The export remains running and has no
completed_at or general download_url. This is a partial metadata-preview
facility, **not** the customer's full archive of source, review, findings,
artifacts or evidence. Audited operator recovery, cleanup, complete archive
delivery, and separately reviewed legal-hold-safe erasure remain unavailable.

A separate **internal ZIP preparation and revocation** path is under development
for issue #44. An eligible installation-bound worker can assemble a bounded ZIP
in private local storage and record a claim-bound, immutable SHA-256/size
commitment with a 15-minute availability window. The server independently
revalidates its ZIP integrity and the original requester's continuing
installation/repository authority on internal reads; verification attempts
are append-only audited. A legal-hold-aware database preview classifies active, held, expired
and cleaned commitments. The new **internal, not scheduled** physical
cleanup function accepts only a claim-bound expired/revoked ZIP with
a verifiable original tenant/installation relationship, private owner-only
directory, immutable digest and a PostgreSQL legal-hold table SHARE NOWAIT
lock plus commitment row lock held through filesystem unlink/fsync. It
writes a one-way `cleaned_at` marker and append-only cleanup audit record
(migration 0114) in the same database transaction. A concurrent hold
writer, active hold, active ZIP, tampered path or mismatched digest fails
closed. Unknown/orphan bytes have no provable tenant ownership and are
never automatically deleted. A failed commit after physical unlink is
recoverable on a later explicit invocation as an audited missing file.
The cleanup is deliberately not invoked in any production worker loop or
HTTP route pending real host acceptance of legal-hold and archive lifecycle.

For this archive commitment only, the original signed-in requester can use
a same-origin
`DELETE /api/v1/data-exports/:exportId?installationId=:id&revoke=archive`
to revoke future ZIP read admission; it does not cancel the export, delete
bytes, release a legal hold, or revoke the independent metadata preview.
The existing DELETE endpoint **without** `revoke=archive` continues to revoke
only the metadata preview. A foreign requester or installation cannot revoke
the original user's ZIP commitment. Unrecognized/repeated `revoke` parameters
are rejected. An internal transactional ZIP-consumption helper keeps the
PostgreSQL commitment read lock until a bounded callback finishes, so a
concurrent requester revocation waits for that callback. A callback failure
rolls back its verified-read audit. An additional internal chunk adapter
passes no more than 16 KiB to each sink call, waits for its acknowledgement
before continuing (backpressure), and checks a 25-second deadline and
cancellation signal before and after writes. An unresponsive sink is not
forcibly detached from its open transaction: it **must** settle when the
connection is closed, or the PostgreSQL lock can remain held. A separate
internal Node HTTP writer now waits for the write callback/drain and fails
closed on real socket disconnect, cancellation and a bounded stalled-write
timeout; a disposable localhost socket test verifies rollback and no false
read audit after the peer closes. This is **not yet an authenticated customer
HTTP endpoint or download-completion receipt**: the Next.js response pipeline,
production socket lifecycle, response-time revocation semantics, durable shared
storage and post-uninstall recovery require separate acceptance. Internal ZIP
chunk consumption can now await an explicit HTTP finish callback *inside* the
database revocation fence. A failed finish rolls back its verified-read audit;
Node HTTP finish only means bytes handed to the OS, not independently confirmed
customer receipt. An internal pull-driven Web Streams bridge now adapts the same scoped
PostgreSQL transaction-held ZIP consumer for a future Next.js `Response`
body. Its 1 KiB read chunks enforce demand/backpressure, and reader
cancellation or bounded transfer deadline rolls back the audit without
publishing a URL or claiming network receipt. This is not a customer route
and does not make a closed Next.js response an independently verified
client download. The GET endpoint now has a **disabled-by-default**
`?installationId=:id&download=archive` path. It requires the canonical
signed-in original requester and active installation/repository authorization,
same-origin browsing context, a live non-revoked commitment and independently
verified private ZIP bytes *before* returning an archive response. Cross-site
and Range requests are rejected. A separately provisioned absolute private
archive root must be set through
`BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT`; the root cannot equal public
`ARTIFACT_STORAGE_ROOT` and must independently pass the same-UID, non-symlink,
0700 checks. The Web Streams body owns the PostgreSQL executor until its
transaction completes or cancels. No archive storage root is deployed by
default. For a currently authenticated original requester, the export-status GET
adds `export.archivePrepared: true` only if opt-in private ZIP delivery is
configured and a live installation-bound archive commitment is still readable.
A signed-in requester can revisit **Settings → Data & Retention** to expand any
of their 10 most recent installation-bound export requests, refresh the current
request status, and access an operator-prepared ZIP if still authorized. This
read-only history is limited to the original requester's active GitHub App
installation; it excludes historical unbound/user recovery records, inactive
repositories, suspended installations, private scope details and stored delivery
URLs. Leaving the original request page never grants or extends ZIP access.

For personal GitHub App uninstall, a signed-in original GitHub user with **or without an active
installation** can now return to **Settings → Data & Retention** to see their
10 latest still-eligible historical USER-scope export request statuses without
knowing an internal export UUID. This read-only list uses the original immutable
GitHub user ID, excludes completed erasure, login-only/unbound legacy rows and
organization requests, and never exposes tenant details, signed links or ZIP
bytes. It is a **status-only** interface; full historical customer export and
post-uninstall archive delivery still require independent acceptance.

The Data & Retention receipt reveals its native ZIP download and a separate
`revoke=archive` action only after a fresh successful status check. A failed
refresh, absent/revoked/expired commitment or missing delivery configuration
hides the link; following it independently rechecks server-side authority,
archive bytes and expiry. This stage signal is not a completed customer export,
physical-file guarantee or proof that the network recipient received ZIP bytes.
The existing worker now supports an opt-in, one-installation-at-a-time
ZIP preparation pass: both `BOARDREADYOPS_EXPORT_PREPARATION_INSTALLATION_ID`
and `BOARDREADYOPS_PRIVATE_EXPORT_ARCHIVE_ROOT` must be configured. It checks
the existing local artifact volume owner and permissions before claiming any
pending export, creates only the reserved
`/data/artifacts/.private-export-archives` directory with mode 0700 and
rechecks its same-UID, non-symlink identity. It checks at most one pending claim
per minute, never automatically reclaims a failed/expired lease and does not
publish an external download capability. The same existing Coolify artifact
volume is mounted by web and worker; there is no new storage product, volume,
worker process, recurring backup, or production enablement by default.
The locally compiled Next.js 16 standalone runtime has additionally passed
a **disposable PostgreSQL 17 + test-only signed session + localhost HTTP**
acceptance: full ZIP bytes match the committed SHA-256, unauthorized/foreign
requester and installation/cross-site/Range access are denied, tampered
archive bytes are rejected before ZIP headers, and the completed read audit
is durable before the original requester revocation finishes. The same
compiled Next.js standalone server has now additionally passed an actual
**signed-in localhost HTTP socket disconnect** test: the original
requester starts downloading an incompressible ~4 MiB ZIP, the client
destroys its connection after the first data chunk, the aborted read's
audit rolls back, and the original requester can revoke without a stale
transaction lock. The separate Node HTTP/Web Streams bridge acceptance
still verifies full-byte integrity and early disconnect independently.
These tests use disposable PostgreSQL and test-only sessions, not
production deployment, a customer's browser, or proof of remote receipt. The production private directory, worker
configuration, legal-hold cleanup scheduling and post-uninstall user recovery
remain disabled/unaccepted.

A separate **operator-only, lease-bound read-only record snapshot** can prepare
a narrowly scoped in-memory JSON slice of release-run summaries and finding
messages from the same active GitHub App installation and selected active
repository. The original preparation worker/token and unexpired lease are
revalidated in one database statement; disabled repositories, suspended
installations, unbound/other-scope requests and stale claims are denied.
More than 100 runs, more than 100 findings, or 256 KiB of serialized JSON
rejects the entire attempt instead of silently exporting a partial list.
The output explicitly excludes artifacts, audit events, review content, source,
backups and platform logs. It is never persisted as an archive, exposed through
an HTTP download, automatically dispatched or used to mark an export completed.
A later full-archive implementation must authorize and assemble all relevant
data classes with separately audited retention and delivery behavior.


Installations are the top-level tenant boundary. Repository, run, artifact, runner,
replay, reconciliation, transition, and deletion records are validated against
that boundary by foreign keys and scope-validation functions. Operational database
records may contain finding messages, repository-relative paths, and internal
artifact storage paths. Audit exports and worker telemetry intentionally omit raw
source payloads, finding content, artifact names, and storage paths.

## Current gaps

The current release does not provide all lifecycle controls requested by issue
#44. In particular:

- physical age-based expiry for runs, findings, accepted result payloads, audit events, and replay/transition history is not activated; managed-artifact expiry is implemented separately as described above;
- organization, repository, and user erasure **request intake** exists, including a 30-day Marketplace-cancellation deadline, but complete erasure execution across relational data and managed objects is not automated;
- GitHub App uninstall now queues an idempotent export request plus a legal-hold-aware 30-day erasure request and revokes repository API tokens, but export materialization and complete post-uninstall deletion execution are not automated;
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
