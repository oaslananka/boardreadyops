# Self-hosted runner registration and execution mode

Issue: #41

## Goal

Allow organizations to run BoardReadyOps readiness jobs on their own tenant-scoped infrastructure without giving untrusted fork PRs or public shared runners access to private hardware data.

## Execution model

Self-hosted runner mode is an explicit opt-in. The default hosted mode remains conservative:

- public same-repository PRs may dispatch the hosted readiness runner,
- private repositories stay in safe mode unless a tenant runner is registered,
- fork PRs stay restricted unless a future reviewed override explicitly allows execution.

## Registration flow

1. Organization admin opens the BoardReadyOps runner settings page.
2. Admin creates a runner registration.
3. BoardReadyOps generates a short-lived registration token.
4. Admin installs the runner agent on tenant-owned infrastructure.
5. Runner exchanges the registration token for a long-lived runner identity.
6. Runner sends signed heartbeats.
7. BoardReadyOps marks the runner as active only after a valid heartbeat.

## Runner identity

A runner registration should include:

- installation id,
- account login,
- repository scope or organization scope,
- runner id,
- runner name,
- public key or shared signing key fingerprint,
- allowed repository patterns,
- last heartbeat time,
- last successfully reported strict agent version,
- disabled time,
- created time.

## Dispatch rules

A private repository run may dispatch to a self-hosted runner only when:

- the repository belongs to the same installation as the runner,
- the runner is active,
- the repository matches the runner allowed scope,
- the PR is not an untrusted fork PR,
- artifact storage is tenant-scoped,
- audit logging is enabled.

## Security boundaries

- Registration tokens must be short-lived and single-use.
- Runner callbacks must be signed.
- Runner logs must not expose repository secrets.
- A disabled runner must stop receiving jobs immediately.
- A stale runner heartbeat should remove it from dispatch eligibility.
- A valid signed claim poll, including an empty-queue response, refreshes presence and, when supplied, the last reported agent version. Replayed requests, unsupported capabilities, invalid signatures, and minimum-version rejections do not refresh presence.
- Fleet visibility must remain installation-scoped and aggregate-only; it must not expose repository names, allowed-repository patterns, source paths, public keys, fingerprints, or individual runner identifiers.

## Acceptance criteria

- Admin can create a runner registration record.
- Runner can be marked active only after a signed heartbeat.
- Private repository safe mode can dispatch only to an active tenant runner.
- Fork PRs remain restricted by default.
- Runner lifecycle events are auditable.
