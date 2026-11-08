# Historical GitHub USER uninstall export — ownership and release acceptance

Status: **SOURCE-ONLY / NO_GO**. This is the evidence boundary for
[Issue #44](https://github.com/oaslananka/boardreadyops/issues/44), not
a privacy notice, legal-disclosure decision, or customer export contract.
The original numeric GitHub USER must be independently authenticated
after uninstall; a recycled matching login never establishes identity.

## Current source coverage is not customer completeness

| Source class | Verified partial snapshot scope | External disclosure blocker |
| --- | --- | --- |
| Repositories | Bounded descriptors; owner/name redacted | Numeric owner and repository scope |
| Release runs | Bounded states and commit SHA; ref redacted | GitHub commit rights |
| Findings | Rule/severity relationships; message/path redacted | Design and third-party content |
| Managed artifact records | Digest, size, type; name redacted | Every live object, rights and retention |
| Reviews | Workflow metadata; title redacted | Collaborator/IP review |
| Review revisions | Revision and evidence digest | Third-party history |
| Review comments | Relations/flags; text and author redacted | Authorship/PII |
| Review approvals | Status; actors and reasons redacted | Actor and evidence rights |
| Review checklist | Completion; title and actor redacted | Contributor/IP rights |
| Finding decisions | Disposition and evidence; reasons/actors redacted | Decision evidence rights |
| Finding assignments | Relationships; assignees redacted | Assignee privacy |
| Installation audit descriptors | Bounded types; actor/metadata redacted | Audit and subject privacy |
| Repository audit descriptors | Bounded types; actor/metadata redacted | Audit and subject privacy |

**Counts only, not raw original payloads:** run_snapshots (design SVG),
api_tokens (credentials), runner_registrations (host identities),
installation_component_credentials (encrypted provider material), and
installation_component_observations (licensed per-tenant intelligence).
A separate private SVG manifest verifies hashes and sizes, not SVG content.
Limits fail closed: absence of included records proves neither completeness
nor a right to disclose.

**Not currently attributable through immutable USER ownership:** tenant-login
billing/Marketplace, workspace membership, policy and some platform/audit
records; backups, process logs, and object-store/platform copies. Do not
attach login-only data to a historical user after account-name recycling.
Source checkout, workflow logs and GitHub Actions artifacts held exclusively
by the customer on GitHub are outside BoardReadyOps's export scope.

## Existing private evidence is not customer delivery

- A numeric original-user, suspended-installation and pending-export gate
  rejects expiry, active hold and real erasure before source/locator reads.
  Locked manifest checks still guard retention, deletion, epoch and races.
- Private physical ZIP v3 verifies bounded local artifacts' SHA-256 and
  length under cooperative unlink fencing. A new SOURCE-ONLY local
  persistence helper fsyncs and no-clobber hard-links the verified
  partial ZIP under the reserved 0700 owner-private archive directory
  as a dedicated .historical-private-partial-v3.zip file, mode 0600.
  It reopens and independently rechecks disk bytes, SHA-256 and
  the partial-ZIP v3 receipt. All three historical ZIP verification
  paths (partial, metadata-only and original USER private preflight)
  explicitly zero temporary extracted metadata and physical-file
  copies on success or rejection; caller-owned ZIP input bytes are
  never overwritten by these verifiers. The SOURCE-ONLY direct reader
  allocates only the exact preflight byte length (at most 64 MiB), reads by
  explicit descriptor offsets and probes one extra byte; concurrent
  growth, truncation, changed file metadata, failed descriptor close
  or a failed digest rejects and zeroes the private read buffer instead
  of allowing unbounded readFile allocation or releasing bytes after
  an unsuccessful close. The higher-level SOURCE-ONLY reserved reader
  returns no receipt without its committed reader reservation,
  independent original USER preflight revalidation, successful
  zeroization and durable reservation release. The original numeric
  USER/export/preflight/ZIP identifiers and trusted local archive root
  are frozen before asynchronous reservation, physical read and
  preflight checks: caller mutation cannot retarget one phase to a
  different identity or physical root. Both a false release and an
  exception from the release provider deny the private receipt. The
  original USER artifact file reader similarly pins the original
  user/export/artifact and trusted local storage root before the first
  asynchronous lookup; a failed durable object release already throws,
  wiping transient private bytes before any return. This is still NOT
  customer streaming. A separate
  private orchestration path
  performs a SECOND original numeric USER DB and physical object/
  hold/retention verification AFTER fsync. Wrong user, changed bytes,
  unsafe directory permissions or symlinks fail closed. An existing
  corrupted destination is never overwritten. Disk files may remain
  quarantined after failure; no background cleanup is enabled for them.
  Source-only migration 0124 now adds an immutable, original numeric USER
  and exact private-preflight-bound cleanup audit. A separate MANUAL-ONLY
  cleanup helper can unlink/fsync a known private partial ZIP only after
  verifying its persisted private preflight SHA/byte length, exact original
  USER, failed export older than one hour, revoked/expired private preflight,
  no active tenant legal hold, non-dry-run erasure, unsettled artifact
  reservations or unexpired private preflight. It uses legal-hold SHARE
  NOWAIT, original export/installation/preflight row locks and the existing
  tenant advisory TRY lock. ZIP content and filesystem inode/mode/owner
  must match before unlink. It records an immutable deleted/missing outcome
  in the database; a failed commit after unlink may require explicit
  missing-file recovery on the next approved cleanup call. Unbound
  orphan ZIPs or corrupted files stay quarantined and are not scanned
  or removed automatically. New source-only migration 0125 supplies a
  persisted, ORIGINAL numeric USER/private-preflight/export-bound
  private ZIP reader reservation with SHA/byte-length, immutable
  identity, once-only release and NO automatic expiry. Its admission
  shares the legal-hold table, original USER/installation/preflight row,
  and tenant advisory locks with the cleanup gate. Registration
  requires exactly one well-formed original-owner, advisory-lock and
  active hold/erasure SQL response row. Duplicate or malformed
  responses fail closed before any reader token is inserted; the
  first row of an ambiguous result grants no ownership or safety.
  The internal verifyReservedHistoricalUserPrivatePartial path COMMITs the reservation
  BEFORE physical ZIP IO, independently verifies disk ZIP+SHA and the
  current original USER DB/physical manifest, then releases it AFTER
  IO; it returns only non-customer verification metadata, NOT bytes.
  Manual cleanup checks unreleased private ZIP reservations as well as
  artifact readers. Its destructive gate requires exactly one original
  numeric USER/preflight owner row, one acquired advisory-lock row and
  one clear hold/erasure/reader status row; duplicate or malformed SQL
  results quarantine rather than unlink. Missing, duplicate or corrupt
  prior cleanup audit responses also fail closed, and the final immutable
  cleanup audit acknowledgement must match the actual missing/deleted
  outcome. A second PostgreSQL connection cannot clean an unresolved
  private ZIP reader, including after export revocation.
  Source-only migration 0125 also rejects parent export deletion while
  any private ZIP reader is unresolved, preventing cascade removal of
  the cross-worker fence. A crashed reader is quarantined indefinitely, NOT reaped on a timer.
  The SOURCE-ONLY, READ-ONLY assessHistoricalUserPrivateReadRecovery
  helper now inspects only the exact suspended original numeric USER,
  uninstall export and private preflight using the same legal-hold,
  owner-row and tenant advisory transaction locks. It returns bounded
  unresolved reader counts, the oldest creation time only when an
  export is FAILED and older than one hour with expired/revoked
  preflight, and an explicit releaseAllowed=false with
  workerLivenessProven=false. Tenant legal hold, real erasure,
  uncommitted concurrent writes, foreign owner and active exports
  fail closed. No raw tokens, private bytes or archive paths appear in
  its response. The table does NOT hold verifiable worker identity:
  age and revocation cannot prove that a reader process is dead.
  This helper never releases any reservation or changes cleanup state.
  The original USER source-only private preflight stage and inspect
  helpers now freeze the exact numeric USER, export UUID, DB executor,
  archive Buffer reference, request TTL/preflight ID before any
  asynchronous physical-owner/source check. They independently hash
  the caller-owned ZIP again after its original-user prepublication DB
  inspection; mutation of its bytes while the DB check is running
  fails closed rather than staging/accepting an out-of-date diagnostic.
  The lower source-only PostgreSQL preflight lifecycle now also pins
  the numeric original USER/export, trusted DB executor, exact ZIP/core/
  visual/mutation SHA and byte length, TTL and preflight UUID before
  asynchronous source sampling or row locks. Both CREATE and INSPECT
  use the pinned binding in authorization and their SQL parameters;
  revocation checks its acknowledgement against the originally
  requested ID rather than a mutable caller object. Adversarial
  tests reject DB/USER/digest substitution between the source read
  and locked INSERT/SELECT and forged revocation acknowledgements.
  These controls are internal only and cannot grant ZIP delivery.
  Extracted metadata and physical-object copies remain zeroized; the
  caller-owned ZIP is not mutated by the verifier. These are private
  observation controls, **not** a coherent atomic DB/FS snapshot or
  a proof that the caller cannot mutate the ZIP after final verification.
  The source-only durable partial ZIP staging coordinator now also
  freezes its exact original numeric USER/export UUID, trusted DB
  executor, local storage root and driver before asynchronous private
  directory creation. Both before/after original-user source reads,
  physical ZIP seal and final disk read use that same pinned binding.
  Mutating a caller-owned request during directory setup or source
  preparation can no longer retarget a second owner/DB or persist under
  a different export UUID. Synthetic source receipts are tested against
  real 0700/0600 temporary filesystem writes for both mutation windows.
  This is a local identity/IO integrity guard, NOT a DB+filesystem
  atomic commit, legal content clearance or public customer capability.
  The old direct low-level disk reader is not automatically wrapped,
  and no customer delivery reader/stream contract or DB+filesystem
  atomic commit exists. This cleanup MUST remain source-only, explicit
  and NOT a scheduled production janitor.
  This is still NOT a complete signed customer archive, streaming grant
  or authorized disclosure.
- The separate three-entry metadata-only ZIP contains zero physical artifact
  bytes. Its hash/receipt is not a trusted identity or disclosure signature.
- Active-installation claim-bound 0700 sealed archive and streaming code
  has a DIFFERENT identity/authority model from post-uninstall USER recovery.
- No historical customer ZIP endpoint, bearer capability or release status
  exists. Every diagnostic returns customer-ready false / NO_GO.

The private source-only Ed25519 observation **signer** now freezes its
trusted database executor, local archive root, key identifier and private
signing KeyObject alongside the original numeric USER/export/ZIP binding
**before the first asynchronous source read**. Mutating a caller-owned
input object during source scope sampling or after reserved physical ZIP
verification cannot redirect later checks to another DB or path, or
substitute a different signing key/identifier. Missing database
transaction capability rejects before any physical read. Regression
tests exercise both mutation windows, verify the original trusted key
and original storage/DB are used, and reject the substituted key.
This is an integrity-only guard for the existing **partial** observation,
not atomic DB/filesystem sealing or customer permission.

**SOURCE-ONLY Ed25519 partial-integrity observation v2 (NOT a customer signature):**
After a durable private ZIP reader reservation, independent original numeric
GitHub USER/preflight/physical-object revalidation and successful reader
release, an internal helper can sign a **five-minute** domain-separated
**format-v2** observation. The v2 canonical message pins the original numeric
USER, export UUID, private preflight UUID, ZIP SHA-256/byte length,
**the private USER/export-bound source-scope SHA-256** covering the known
PostgreSQL catalog and 19 bounded hardware source-class counts, signing-key
identifier, and immutable `completeCustomerExport=false` /
`customerDeliveryAllowed=false` flags. The v2 domain and field allowlist
reject legacy v1 signatures rather than silently upgrading old observations.
Cryptographic verification requires a pinned Ed25519 public key, exact
expected binding AND independently expected source-scope digest.
An additional internal *live* verifier first authenticates the v2
signature, then independently re-reads the original numeric USER's current
source-scope digest and all NO_GO invariants. It MUST also acquire a fresh
committed private reader reservation, reopen and independently verify the
still-present local ZIP, revalidate the current private DB/physical-object
preflight and durably release the reservation. The signed source fingerprint
must match both before AND after this physical re-read; a deleted/replaced
ZIP, failed reservation/settlement, changed schema, bounded source-count
digest, tracked mutation epoch, legal hold, real erasure or denied owner
scope blocks the private observation even within five minutes. The
LIVE physical+DB re-verifier checks the signed five-minute window using
the trusted server clock BOTH before any reserved ZIP read and after
all DB+physical verification. It ignores any caller-supplied test/offline
clock override, denies signatures that expire during the read or a
backward-moving server clock, and pins the trusted signature key/DB,
original numeric USER and private root throughout asynchronous checks.
This is a short-lived private diagnostic truth claim, NOT a customer's
download authorization or a complete DB+filesystem commitment.
The archive root is a trusted server-injected private path, NOT a user-supplied
URL, and no bytes or download capability are returned.
For existing historical mutation epoch triggers from migrations 0118–0120
(core repository/run/finding/artifact rows, supported review/collaboration,
private visual and audit classes), the private source-scope digest now
also incorporates the **original-USER installation-bound mutation epoch**
captured inside the **same** read-only PostgreSQL snapshot as catalog and
the nineteen bounded source counts. Count-preserving edit-restore changes
to those *tracked* sources invalidate the previous scope digest even when
the original bytes and source counts return to their previous state.
The internal v3 source-scope hash additionally binds **all nineteen original
numeric USER owner-joined, bounded hardware row-multiset SHA-256 digests**.
PostgreSQL hashes each complete row's JSONB representation and then hashes
sorted per-row digests, so no BOM, firmware, private IP or third-party raw
row content is transferred to the application. Any row count above 100 per
class, ambiguous owner, foreign scope or malformed digest fails closed.
Changing hardware/BOM data while keeping row counts unchanged now changes
the internal source-scope digest. Existing 0118–0120 mutation epochs also
detect edit-then-restore for the tracked core/review/visual classes.
No hardware mutation epoch was added: an edit restored byte-identically
between independent reads remains unobservable for untracked tables.
These DB-only hashes do not prove physical file bytes or disclosure rights.
The v3 internal scope domain separates the earlier v2 count-plus-epoch
digest; the source-only Ed25519 partial observation format remains v2.
**Locked source-only prepublication evidence binding:** The short-lived
original USER prepublication gate now pins the expected core/visual SHA-256,
byte lengths, visual count, mutation epoch, and bounded under-lock physical
operation before acquiring any database lock. It compares both independent
source snapshots against those SAME initial values. Changing the caller's
expected receipt after an owner lookup or during physical IO cannot
reinterpret a changed source as eligible, and a replacement callback
cannot run in place of the original locked operation. Three adversarial
red/green tests cover both digest-swap windows and the callback swap.
This is still not a durable atomic DB/filesystem commitment, legal/IP
clearance, a customer export or an HTTP publication capability.
**Internal partial signer pre/post source-scope guard:** Before initiating
any reserved physical ZIP read, the original numeric USER source scope is
checked using a fresh read-only repeatable-read PostgreSQL snapshot; after
the full private ZIP read, original preflight revalidation and durable
reader release, the scope is checked again under a second read-only snapshot.
A changed catalog, bounded hardware count, or already tracked mutation
epoch during that verification denies the signature even when the ZIP SHA
and length are unchanged. Failure to read either scope also denies the
observation; it does not publish a capability or deliver archive bytes.
These are **two independent database snapshots**, NOT one atomic DB/FS
commitment or a guarantee against mutations after the final check.
**Untracked edit-then-restore hardware history, unlinkable legacy rows,
cross-DB/FS races and third-party rights remain unproven; a live digest match is NOT archival
completeness or customer delivery authorization.**
The signing timestamp comes from the server clock, not a request parameter.
The private signing key is injected by the trusted server caller, never
generated, logged, persisted or read from a user-provided field here.
There is **no production key configuration, signer deployment, customer
endpoint, complete DB+filesystem commitment or live delivery grant**.
Signing a partial ZIP does not transform it into a complete archive or
authorize disclosure. Independent key lifecycle, coherent DB+filesystem
signatures and customer publication/retrieval acceptance remain NO_GO.

**Source-only signed-session private preflight:** The internal
data-export-historical-signed-session module now derives the immutable
numeric GitHub USER solely from a verified, same-server HMAC-signed
GitHub OAuth session cookie (not URL/body parameters, mutable login or
installation membership). Private stage, inspect and one-way revoke
require the cookie to have been issued within five minutes, be unexpired
and have the configured maximum session lifetime. The existing
original USER DB checks, actual ZIP verification, exact artifact manifest,
active-hold/erasure/retention admission and append-only revocation audit
still apply. Tests deny tampering, wrong signature, expired/old/future
sessions and recycled logins. This is NOT a fresh live GitHub account
introspection on every request, an externally signed archive, or a
public customer-download route; those remain hard release blockers.


**Separate SOURCE-ONLY fresh GitHub OAuth step-up diagnostic:** A new
internal server helper now requires a recently signed GitHub USER session
plus a server-minted, one-use OAuth authorization code, a CSRF state
cookie matching the callback state, and a return path bound to the
exact historical export UUID. The code is exchanged with GitHub over
HTTPS and the resulting GitHub /user numeric ID must match the signed
session's original numeric user ID, not its mutable login. The temporary
GitHub access token is not persisted or placed into the private ZIP.
Only after a successful match may a private, permanently non-customer
preflight be staged using existing locked database and artifact gates.
The server rechecks the SAME pinned signed original-USER session after all
GitHub provider IO. Elapsed server time is added to the initially verified
clock, so a session aging beyond five minutes while GitHub responds, or a
backward server clock jump during the call, denies even a valid numeric
/user match. Request mutation cannot swap the signed cookie mid-flight.
This is still only a source-side privacy diagnostic; it does not grant
customer delivery, legal rights or archive completeness.
It rejects invalid, expired, unrelated and foreign-account proofs.
A separate **default-OFF** source-only OAuth start route now uses the
already-registered GitHub callback URL. It requires a fresh signed session
and database-scoped pending historical export BEFORE issuing two
`__Host-` HttpOnly/Secure/SameSite=Lax state and HMAC proof cookies.
The proof cryptographically binds original numeric USER, exact export
UUID, random state and a maximum five-minute age. On callback, both
cookies are cleared on success or failure; the same-server signed
original USER, live GitHub /user ID and pending export must still match.
The callback does not create a fresh dashboard session, durable customer
identity proof, preflight record, ZIP, delivery token or external URL.
Additive migration 0122 introduces a durable original-user-scoped
nonce ledger: ONLY the domain-separated SHA-256 digest of the 32-byte
OAuth state, immutable export/user/issuance/expiry and a one-way consumed
timestamp. Registration is denied without a pending unexpired export
linked to a suspended original numeric USER and is blocked by active
tenant holds or running/completed non-dry-run erasure. PostgreSQL
atomically consumes a nonce BEFORE any GitHub code exchange. Both
registration and consumption now follow the existing historical original
USER preflight lock order: legal-hold table SHARE NOWAIT, original export
and suspended USER installation row SHARE NOWAIT, then the tenant-scoped
transfer advisory transaction lock (nonblocking TRY). These locks protect
against uncommitted concurrent legal-hold writes and real erasure writers
using the same tenant lock, then recheck the hold/erasure predicates inside
the transaction; lock contention denies rather than waiting for GitHub.
Two disposable PostgreSQL tests deliberately hold uncommitted legal-hold
and erasure writer transactions while issuing/consuming a nonce and
prove both fail closed. Locks are released BEFORE GitHub HTTP; they are
never held across an external request. Simultaneous or repeated
callbacks cannot both succeed; provider failure burns the nonce
irreversibly. Browser state and proof cookies are also cleared.
A challenge record remains until the source export is lawfully removed.
Source-only migration 0123 adds a per-export time index. The nonce
registration transaction uses the existing tenant admission advisory
lock to enforce a bounded rolling quota of **24 challenges per five
minutes** and a **128-challenge lifetime maximum per export**.
Consumed, expired and failed OAuth attempts count toward lifetime;
consumed attempts also count toward the rolling window. Limits apply
BEFORE an OAuth redirect and are fail-closed across concurrent workers;
the audit is not erased or silently rotated to free quota.
This is a private authentication audit primitive, **not** a customer
delivery capability, source rights or evidence of complete archive sealing.
The source-only migration and default-off feature are UNDEPLOYED;
there is still no real external GitHub consent/browser acceptance.
Feature flag:
`BOARDREADYOPS_ENABLE_HISTORICAL_OAUTH_STEPUP=true` (unset/false
means disabled). It must remain off in production pending acceptance.
No customer-download endpoint exists.

**SOURCE-ONLY durable fresh GitHub USER OAuth confirmation:** Migration
`0126_historical_user_live_oauth_verified_proof` adds a separate append-only
five-minute verification record tied to the existing one-use, SHA-256-only
OAuth nonce ledger, exact original numeric GitHub USER and suspended
uninstalled-account export. The normal successful historical callback
now commits this record ONLY after the consumed nonce, successful GitHub
OAuth code exchange, live `/user` numeric identity match, and current
original-export check. Confirmation, independent inspection and one-way
revocation use legal-hold SHARE NOWAIT, original USER/installation locks,
the tenant transaction advisory TRY lock and active real-erasure checks.
Wrong account/export, consumed-but-unsuccessful codes, expired nonce,
duplicate callback/confirmation, hold and erasure fail closed. The
verification record cannot be selectively deleted or converted to a
download grant, and it does not retain OAuth tokens, codes, browser
state or login. A callback redirects to the safe dashboard only if
the durable confirmation succeeded; missing migration, unavailable DB
or interrupted provider verification fails closed. **Even a fresh,
unrevoked record is diagnostic authentication evidence only**: no
customer ZIP, independently scoped source rights, complete archive,
delivery URL, bearer token or streaming entitlement exists. This
migration and its feature flag remain UNDEPLOYED and OFF.

**SOURCE-ONLY source-schema coverage guard:** The original-user private
data-class audit now fingerprints the complete catalog structure, not
customer rows: public base-table names and all ordered column names,
types and nullability as observed in PostgreSQL 17 after migration 0126.
The explicit baseline is **92 tables / 1,033 columns**, with 13 tables
contributing to the **redacted partial private metadata candidate**,
16 deliberately sensitive withheld classes and **63 further tables still
requiring an independent source/ownership/IP-scope decision**. These
63 source classes are individually assigned to five non-authorizing
review queues in [the original USER source-class review register](historical-user-source-class-review.md). The
nineteen-class source-only hardware row-attribution preflight uses original numeric
GitHub USER/suspended-installation repository/run joins only to
produce bounded private row COUNTS, including strictly cross-checked
manufacturing share/run/attempt/artifact/signed-evidence candidates.
A separate read-only PostgreSQL foreign-key *metadata* audit now
identifies **34/63** unresolved classes with a structural path to an
installation and **29/63** without that FK path. Its exact table-level
review inventory is in the source-class register linked above; it does
not read customer rows or establish any original numeric USER ownership,
redistribution right or ZIP entitlement. The 29 disconnected classes
require separate historical linkage evidence, and 34 structurally
connected classes still need independent rights and content validation.
For the unlinked `data_exports` class, a separate **count-only** original
numeric USER lineage review now distinguishes retained numeric-ID records,
historical aliases, login-only legacy rows and other numeric USERs reusing
that login. It refuses missing/expired authority, holds, erasures and
oversized candidates; it neither backfills ambiguous users nor exposes
customer bytes, URLs or records. All classes remain **DENY**.
A further read-only, bounded review covers four additional tenant-login
only classes (`retention_policies`, `legal_holds`, `erasure_requests`
and `product_events`), returning only per-class candidate counts and
a recycled/unbound-user identity collision flag. It cannot attribute
legacy rows by username, and still denies a customer export.
Five additional billing/Marketplace classes now have a separate,
read-only numeric-versus-login owner-candidate review. Four classes
expose tenant-login-only bounded counts; the GitHub Marketplace
class can distinguish a direct numeric account match from a different
account using the same login. Tenantless provider billing events and
all provider-disclosure rights remain unresolved. A separate read-only review covers **seven** more workspace,
project, membership and append-only policy-audit classes. It returns
bounded numeric-user versus reusable-login candidate counts only:
workspace membership does **not** prove rights to disclose shared
projects, collaborators' material, audit events or third-party IP.
The final **nine** FK-unlinked private export/OAuth/reservation
control classes now have a separate count-only original numeric
USER source review. Conflicting numeric identity or cross-tenant
reservation evidence fails closed; a login-only unlink fence can
never authorize a customer export. The remaining **three** no-FK
classes — `cloud_schema_migrations`,
`component_lifecycle_observations` and `control_plane_jobs` —
are explicitly **platform operational exclusions** from customer ZIP
content, with independent retention/privacy/licensing obligations
still unverified.

The **29/29 no-FK-class triage map** is complete: **26 bounded
private source-candidate reviews plus 3 platform-only exclusions**.
It is **not 29 verified customer ownership classes** and does
not prove DB+physical object archive completeness or third-party
disclosure rights. All **63** unresolved classes remain DENY and
customer archive release remains NO_GO.
The internal source-only partial-integrity observation additionally
requires the schema fingerprint and all nineteen bounded hardware
class counts to pass under a **single PostgreSQL REPEATABLE READ READ
ONLY** transaction, with exact original numeric USER/export binding.
Any schema drift, foreign ownership, legal hold, real erasure, malformed
count, failed transaction or denied scope blocks that internal signature.
The scope digest remains private and is not the signed artifact's claim
of DB+filesystem atomicity, completeness or customer delivery.
Ambiguous original USER share authority, actor, workspace, digests,
deleted references and cross-tenant linkage fail closed. No source
payloads, consent/third-party disclosure rights, guaranteed coverage
of disconnected legacy rows, customer ZIP eligibility or complete
snapshot are implied.

The same read-only repeatable-read catalog audit now also fingerprints
the exact **13 enabled original-user mutation-epoch triggers** and their
**six SECURITY INVOKER function definitions/configurations**. This matters
because the partial source receipt relies on these triggers to detect
committed edits that restore identical row bytes (ABA): a dropped, disabled,
retargeted trigger, changed function body, changed search_path, or changed
security mode produces schema drift and blocks that internal signature.
Rollback-only PostgreSQL regressions exercise both a disabled trigger and
a changed function body. This guard protects only the currently implemented
13-trigger partial-snapshot coverage; it does NOT add mutation-epoch coverage
for the other source classes or prove row completeness, cross-store atomicity,
ownership, third-party rights, or customer disclosure.

A newly
added table, changed column or unavailable catalog produces a
`schema_drift` or `unavailable` assessment. Neither the known baseline
nor a green signature means a complete export or approved legal scope:
**every assessment is NO_GO / customerDeliveryAllowed=false**. The
source-only Ed25519 partial-integrity helper refuses to sign unless this
independent catalog check recognizes the current schema. Its check is
not an atomic DB+filesystem snapshot seal and does not inspect row
completeness, user consent, provider files or disclosure rights.
Public customer delivery must not be enabled based on this report.

## Required to satisfy Issue #44's outstanding customer acceptance

1. Approve and test exact BoardReadyOps-owned include/exclude boundaries,
   all third-party contributor, secret and proprietary content rights, and
   GitHub-only source exclusions without copying private content into logs.
2. Prove the complete eligible original numeric USER source inventory
   across all suspended installations and scoped repositories, with explicit
   tenant/platform exclusions and fail-closed row and byte bounds.
3. Durably seal a coherent DB plus physical-object snapshot; verify every
   included object's SHA-256 and length, writer/delete/hold fences and crash
   consistency. A self-reported ZIP hash is NOT an external signature.
4. Bind a service-authenticated complete archive commitment to freshly
   verified original-requester identity/entitlement at publication/retrieval.
   Never re-enable an uninstalled installation to claim the historical user.
5. Implement audited, expiring, revocable customer delivery that handles
   cancellation, disconnect, hold and erasure while bytes are in flight.
   A partial ZIP can never set completed/exportable status.
6. Verify worker restart, shared volumes, expiry/recovery/cleanup and real
   storage-driver acceptance in isolated PostgreSQL and end-to-end tests,
   then obtain source CI and production rollout evidence.

Uninstall export REQUEST INTAKE is non-destructive and can occur during
legal hold; actual materialization/retrieval remains withheld pending
applicable authorization and rights review.

See [data lifecycle](data-lifecycle.md) and
[product status](../product/current-state-matrix.md).
