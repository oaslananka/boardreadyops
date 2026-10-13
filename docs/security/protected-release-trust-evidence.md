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
5. The evidence-only migration 0088 persists a separate append-only table,
   rechecks current installation/repository identity with row locks, permits
   identical idempotent retries and rejects conflicting retries. Uninstall
   foreign-key cascading is preserved.

No HTTP endpoint, release-run creation, workflow dispatch, outbox insertion,
runner lease, secret access, artifact grant or OIDC permission is enabled.

## Required work before protected-release can execute

An explicit GitHub-admin operator action with CSRF validation must be bound to
an immutable, versioned execution-authority snapshot, followed by a distinct
branch-only queue/supersession contract and exact runner lease, dispatch,
execution-attempt and OIDC callback binding.

The experimental OIDC subject matcher supports GitHub's documented legacy and
immutable repository-ID formats; it deliberately rejects customized subjects
unless a reviewed policy is introduced. This matcher is not connected to an
OIDC callback and cannot grant a release by itself.

Issue #42 remains open, as does two-independent-installation acceptance #154.
The evidence-only helpers must not be used as customer readiness or production
release approval.
