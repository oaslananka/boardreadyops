# Private repository and fork PR safe mode

Issue: #42

## Goal

BoardReadyOps treats private-repository pull requests, fork pull requests, and draft pull requests as higher-risk execution contexts without making private same-repository development unusable.

## Safe-mode triggers

The normalized lifecycle action records these reasons in deterministic order:

1. `draft-pull-request`
2. `fork-pull-request`
3. `private-repository`

Safe mode is enabled when one or more reasons apply.

## Dispatch policy

| Context | Workflow dispatch | Release-run terminal state |
| --- | --- | --- |
| Public, same-repository, ready PR | Dispatch normally | Runner callback decides |
| Private, same-repository, ready PR | Dispatch with safe-mode metadata | Runner callback decides |
| Fork PR | Do not dispatch privileged workflow | `completed` / `neutral` |
| Draft PR | Do not dispatch privileged workflow | `completed` / `neutral` |

Private repositories are not skipped solely because they are private. The central readiness workflow receives validated safe-mode metadata and must avoid privileged operations for that run.

Fork and draft skips complete both the database release run and the GitHub check with the same completion timestamp. Webhook retries can repair an incomplete GitHub check without redispatching a terminal run.

## Workflow inputs

The GitHub App passes:

- `safe_mode`: exactly `true` or `false`
- `safe_mode_reasons`: a comma-separated list from the three allowed reasons

The client rejects unknown reasons, an enabled flag without a reason, and reasons supplied while safe mode is disabled. It deduplicates reasons and emits them in the canonical order above.

The workflow independently validates:

- release run ID as a lowercase UUID,
- target as a bounded GitHub-style `owner/repository` identifier,
- head SHA as a full lowercase 40-character commit SHA,
- safe-mode flag/reason consistency,
- reason allow-list and duplicate reasons,
- exact production callback URL for the release run.

Invalid input fails the runner preparation step. The OIDC-authenticated callback records an error result when the callback identity and run binding remain valid.

## Retry and idempotency behavior

The lifecycle store returns the existing run status with the idempotent enqueue result.

- A queued run with an existing check may retry workflow dispatch after a transient dispatch failure.
- A dispatched, running, or terminal run is not dispatched again.
- A completed fork/draft run may re-complete its neutral GitHub check to repair a prior API failure.
- Workflow dispatch no longer writes a dispatch identifier into the readiness `decision` field.

## Runner expectations

When safe mode is enabled, runners must:

- avoid privileged writes unless explicitly authorized by repository policy,
- avoid exposing private artifacts,
- never make installation or repository secrets available to untrusted fork code,
- treat repository content as untrusted input,
- prefer advisory findings unless policy explicitly enables enforcement,
- preserve artifact and log isolation between installations.

## Current implementation slice

This change provides detection, validated workflow inputs, fail-safe dispatch policy, terminal skip consistency, and retry behavior. Full repository checkout, policy evaluation, artifact production, and public Marketplace hardening remain separate runtime work.
