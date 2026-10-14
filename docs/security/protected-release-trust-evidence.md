# Protected-release trust evidence (not an enabled release path)

Status: **prerequisite implementation only**. Protected-release dispatch,
runner leases and OIDC callbacks are not enabled by this change. Existing PR
standard/safe paths remain unchanged.

## Evidence and authority boundaries

1. Server-only code uses an unexpired signed GitHub viewer session. A bearer
   token or self-declared actor is insufficient. Current installation access
   must match the authoritative database repository.
2. An installation-scoped GitHub token observes numeric repository ID, actual
   default branch, exact branch HEAD and effective branch review/check rules.
   It rechecks repository identity and HEAD after reading the rules.
3. GitHub's collaborator permission endpoint must return admin and the same
   immutable user ID as the signed session.
4. Versioned evidence binds both GitHub and internal repository identity,
   actor, branch ref/SHA and explicit request ID. Its SHA-256 digest is for
   correlation, **not** signing, replay protection or authorization.
5. Migration 0090 adds an evidence v2 owner-ID binding: both live GitHub
   repository reads must agree on an immutable numeric owner ID. The v2
   evidence digest and append-only row contain that ID. Existing v1 rows
   remain untouched and cannot be used as v2 authority.
6. The evidence-only migration 0088 persists a separate append-only table,
   rechecks current installation/repository identity with row locks, permits
   identical idempotent retries and rejects conflicting retries. Uninstall
   foreign-key cascading is preserved.

No **execution-authorizing** HTTP endpoint, release-run creation, workflow dispatch, outbox insertion,
runner lease, secret access, artifact grant or OIDC permission is enabled.

## Required work before protected-release can execute

An explicit GitHub-admin operator action with CSRF validation must be bound to
an immutable, versioned execution-authority snapshot, followed by a distinct
branch-only queue/supersession contract and exact runner lease, dispatch,
execution-attempt and OIDC callback binding.

The experimental OIDC subject matcher supports GitHub's documented legacy and
immutable repository-ID formats. Both formats require a signed owner ID that
matches the independently verified persisted authority, not merely the ID
repeated within the token. Customized subjects are rejected unless a reviewed
policy is introduced. This matcher is not connected to an
OIDC callback and cannot grant a release by itself.

Issue #42 remains open, as does two-independent-installation acceptance #154.
The evidence-only helpers must not be used as customer readiness or production
release approval.


## Non-executable identity seal (migration 0089; not an enabled feature)

A separate immutable execution seal may reserve one branch-only run and
attempt UUID for a previously recorded evidence candidate. The server-invoker
transaction rebinds the canonical installation, repository, GitHub IDs, actor,
default branch and exact candidate ref/SHA, rejecting private or disabled
repositories. It refuses stale evidence using PostgreSQL server clock time,
enforces one candidate / run / attempt identity, and computes its own SHA-256
snapshot digest from the complete versioned identity.

Migration 0091 enforces a candidate-to-seal snapshot version match at the
database insertion boundary: a v2 owner-verified candidate cannot be sealed
using the legacy v1 identity digest that omits owner ID. Historical v1
candidate/v1 seal pairs remain supported. The table reserves a separate
owner-bound v2 snapshot shape, but no new v2 sealer or dispatch permit exists.

**A seal is not execution authority:** a database check forces
`dispatch_allowed = false` permanently; no outbox, workflow,
`release_runs` record, runner lease or OIDC callback is created.
No live API calls the seal yet. Its future consumer must require an atomic
authorized enqueue with fresh GitHub rules/commit evidence, tenant scoping,
replay protection, exact run/attempt lease ownership and signed OIDC claims.
The reserved UUIDs must never be accepted as capabilities on their own.


## Session-only intent recording API (evidence only)

The optional GET/POST endpoint at
`/api/v1/repositories/{repositoryId}/protected-release-intent` is an
**observation-only API**, not a release or workflow action. A signed GitHub
viewer cookie is required; bearer tokens and generic application admin scopes
are insufficient. A GET obtains a no-store, purpose/session/repository-bound,
10-minute CSRF token. POST requires the configured HTTPS Origin, the CSRF
header, a bounded strict JSON body containing only exact SHA and request ID,
and the same signed viewer. Server-side recording rechecks database
installation/repository mapping, live GitHub `admin` identity and the
protected default branch rules/HEAD before writing the evidence candidate.

The response's `dispatchAllowed: false` is descriptive, never a capability.
No caller may promote an evidence candidate or execution seal to a runner
lease, OIDC verification, artifact permission or trusted workflow by using this
endpoint. The independently guarded execution-authority chain remains
unimplemented and **PR #1110 stays draft** until complete.
