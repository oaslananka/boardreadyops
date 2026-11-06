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
  the partial-ZIP v3 receipt; a separate private orchestration path
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
  and tenant advisory locks with the cleanup gate. The internal
  verifyReservedHistoricalUserPrivatePartial path COMMITs the reservation
  BEFORE physical ZIP IO, independently verifies disk ZIP+SHA and the
  current original USER DB/physical manifest, then releases it AFTER
  IO; it returns only non-customer verification metadata, NOT bytes.
  Manual cleanup checks unreleased private ZIP reservations as well as
  artifact readers. A second PostgreSQL connection cannot clean an
  unresolved private ZIP reader, including after export revocation.
  A crashed reader is quarantined indefinitely, NOT reaped on a timer.
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
