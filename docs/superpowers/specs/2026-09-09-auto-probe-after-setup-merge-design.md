# Auto-Probe After Setup PR Merge

## Problem

BoardReadyOps can create a zero-touch setup PR from `/boardreadyops setup`, but merging that PR leaves the persisted repository setup revision at `workflowStatus=unknown` and `configStatus=unknown`.

Production exposes the readiness probe only through the operator setup API, and that API is intentionally disabled in the public runtime. The generated setup workflow also declares probe inputs but currently has no `setup-probe` job, so even a manually dispatched probe cannot publish the OIDC-authenticated setup result. As a result, an installed repository can merge the canonical BoardReadyOps setup PR yet remain permanently unready for `release.prepare` unless an operator intervenes.

This violates the product goal: **Install once → open a PR → BoardReadyOps does the rest.**

## Goal

The generated setup workflow must include a self-contained `setup-probe` job that validates the default-branch configuration and publishes the existing OIDC-authenticated callback. When the canonical BoardReadyOps setup PR is merged into the repository default branch, BoardReadyOps automatically dispatches that persisted probe. A successful probe must produce the same `ready/ready` setup revision as the operator API path, without manual database mutation.

## Trigger and Scope

The trigger is a GitHub `pull_request` webhook with all of these properties:

- action is `closed`;
- the pull request was merged;
- head ref is the canonical BoardReadyOps setup branch (`boardreadyops/setup`);
- base ref is the repository default branch;
- the event belongs to an installed repository known to the control plane.

All other closed/merged pull requests remain no-ops for setup probing. This avoids probing arbitrary customer branches or unrelated automation PRs.

The lifecycle normalizer emits a dedicated durable setup-probe interaction carrying the installation, repository, merged commit SHA, PR number, and delivery ID. It must not enqueue a release run directly.

## Data Flow

1. Setup PR generation embeds the trusted BoardReadyOps public HTTPS origin into the canonical workflow; the generated workflow requires no repository secret or Actions variable.
2. The generated `setup-probe` job checks out the default branch, validates the tracked config with the pinned BoardReadyOps CLI, obtains an OIDC token scoped to `boardreadyops-setup:<probeId>`, and posts only to the embedded trusted callback origin.
3. `normalizeGitHubAppWebhook` recognizes the canonical merged setup PR and emits a durable setup-probe interaction.
4. The control-plane worker invokes a repository-setup automation method for that interaction.
5. The automation resolves the existing repository/setup revision, inspects GitHub workflow metadata, and requires the merged default-branch state to be `probe_required`.
6. It creates a persisted setup probe using the existing repository setup store, with an idempotent request key derived from the webhook delivery.
7. It dispatches `.github/workflows/readiness-runner.yml` using the existing `RepositorySetupGitHubClient.dispatchProbe` path.
8. The workflow posts its OIDC-authenticated result to the existing setup-probe callback.
9. The existing completion store creates the terminal setup revision with the observed SHA and `workflowStatus/configStatus` result.

No new callback endpoint, release-run state, or manual readiness mutation is introduced.

## Idempotency and Failure Handling

Webhook replay must not create duplicate persisted probes or normal-path workflow dispatches. The setup-probe request ID is derived from the GitHub delivery ID and uses the store's existing replay/conflict semantics. If a transport failure leaves dispatch outcome ambiguous, retry may dispatch the same probe ID again; the callback and probe completion remain idempotent and the workflow concurrency key is probe-bound.

If GitHub workflow inspection reports `actions_disabled`, `disabled`, or `incompatible`, the interaction records the existing fail-closed setup state and completes without release dispatch. A `missing` workflow immediately after the canonical merge is treated as potentially eventual GitHub metadata and remains retryable through the bounded control-plane job budget; GitHub/API/database transport failures are retryable as well.

A merged setup PR never grants readiness by itself. Only the existing OIDC-authenticated probe result can establish `ready/ready`.

## Security Boundary

The change does not widen repository mutation paths. The setup PR remains limited to the existing allowlist and requires human merge. The generated probe job has only `contents: read` and `id-token: write`; its callback URL is pinned to the trusted public app origin at setup-PR generation time, preventing an Actions-dispatch caller from redirecting the OIDC token to an arbitrary host. The post-merge automation only inspects repository metadata, dispatches the reviewed readiness workflow, and consumes the already-authenticated probe callback.

## Verification

TDD must cover:

- generated workflow: canonical setup PR contains a `setup-probe` job, pins the trusted callback origin, grants no write permission, and validates/publishes the existing callback contract;
- lifecycle normalization: canonical merged setup PR is accepted; unmerged, wrong branch, wrong base, and unrelated closed PRs do not trigger a probe;
- worker/automation routing: the durable interaction creates/dispatches exactly one existing setup probe and preserves retry semantics for infrastructure failures;
- idempotency: replaying the same delivery does not duplicate probe or workflow dispatch;
- repository setup completion: the existing callback persists the expected observed SHA and `ready/ready` state;
- regression: ordinary PR release-run behavior and slash-command setup behavior remain unchanged.

After focused tests, run typecheck/Biome/diff checks and the repository's full verification gate. Merge only through the existing protected-main/Mergify governance.

## Production Acceptance

After deployment, repeat the real test-repository flow: `/boardreadyops setup` → merge generated setup PR → automatic setup probe → persisted `ready/ready`. Then run `/boardreadyops release-preview` on the hardware PR and verify exact-SHA Check Run/workflow behavior with no manual database mutation and no release publication.
