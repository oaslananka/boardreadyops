# Self-hosted runner mode

Issue: #41

## Goal

BoardReadyOps supports an explicit execution-mode switch for teams that do not want release-readiness jobs to use the default GitHub Actions dispatch path.

## Modes

| Mode | Value | Current behavior |
| --- | --- | --- |
| GitHub Actions dispatch | `github-actions` | Default compatibility mode. The GitHub App dispatches `.github/workflows/readiness-runner.yml`. |
| Self-hosted runner | `self-hosted` | The hosted app records the release run and check context without dispatching GitHub Actions. The run remains queued for a future tenant runner claim API. |
| Disabled | `disabled` | The app records lifecycle context but creates no workflow dispatch. |

An unrecognized mode fails closed to `disabled`; it never falls back to GitHub Actions.

## Configuration

```text
BOARDREADYOPS_RUNNER_MODE=github-actions
BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL=default
BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE=1
```

`BOARDREADYOPS_RUNNER_MODE` accepts only `github-actions`, `self-hosted`, or `disabled`.

The self-hosted label must be 1–64 ASCII characters, start with an alphanumeric character, and contain only alphanumeric characters, `.`, `_`, or `-`. Invalid self-hosted labels disable dispatch rather than selecting a fallback runner.

Self-hosted safe mode defaults to enabled. It may be disabled only with an explicit `0`, `false`, or `no`; accepted enabled values are `1`, `true`, and `yes`. Any other value disables dispatch as an invalid configuration.

Self-hosted-only variables are ignored while the mode is `github-actions` or `disabled`, so dormant configuration cannot unexpectedly break hosted dispatch.

## Registration model

Runner registrations are tenant-scoped through the GitHub App installation and include:

- runner id and name,
- installation scope,
- optional repository allow-list,
- public-key or signing-key fingerprint,
- lifecycle status,
- activation, heartbeat, disabled, and creation timestamps.

The database permits an active runner only after an identity fingerprint, activation timestamp, and heartbeat timestamp exist. Duplicate fingerprints within one installation are rejected.

## Execution model

1. A verified GitHub webhook creates a release run.
2. The app resolves and validates the deployment-level runner configuration.
3. In `github-actions` mode, workflow dispatch continues through the OIDC-authenticated readiness workflow.
4. In `self-hosted` mode, the run remains queued without a GitHub Actions dispatch.
5. A future tenant-scoped claim API will select an active runner whose heartbeat and repository scope are valid.
6. The runner posts an authenticated result callback.
7. The app updates check-run output, PR comment, findings, and dashboard state.

This control-plane slice does not yet provide registration-token issuance, signed heartbeat, job claim, or runner disable APIs. Operators should not enable `self-hosted` mode until those APIs and an active tenant runner are available, unless intentionally testing queued-run behavior.

## Safe-mode expectations

Self-hosted mode should preserve advisory-only execution for:

- private repositories without an eligible tenant runner,
- fork pull requests,
- draft pull requests,
- repository policies that require safe mode.

A future eligibility query must verify installation ownership, runner status, heartbeat freshness, repository allow-list, artifact isolation, and audit logging before a job is claimable.

## Operational verification

After changing runner-mode variables:

1. restart or redeploy the web container;
2. verify `/api/health` remains healthy;
3. send a signed webhook in a test installation;
4. confirm the webhook response reports the expected `runner.mode`, `runner.dispatch`, and `runner.configurationValid` values;
5. confirm no GitHub Actions workflow is dispatched in `self-hosted` or `disabled` mode.
