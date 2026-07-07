# Self-hosted runner mode

Issue: #41

## Goal

BoardReadyOps should support a self-hosted execution mode for teams that do not want release-readiness jobs to run in the default GitHub Actions dispatch path.

## Modes

| Mode | Value | Description |
| --- | --- | --- |
| GitHub Actions dispatch | `github-actions` | Default mode. The GitHub App dispatches `.github/workflows/readiness-runner.yml`. |
| Self-hosted runner | `self-hosted` | The hosted app records the run and a self-hosted worker claims it through an internal queue/API. |
| Disabled | `disabled` | The app creates check-run context but does not dispatch execution. |

## Configuration

```text
BOARDREADYOPS_RUNNER_MODE=github-actions
BOARDREADYOPS_SELF_HOSTED_RUNNER_LABEL=default
BOARDREADYOPS_SELF_HOSTED_RUNNER_REQUIRE_SAFE_MODE=1
```

## Registration model

A future runner registration flow should create a runner record with:

- runner id,
- installation id or account scope,
- allowed repositories,
- labels,
- last heartbeat timestamp,
- public key or shared registration credential fingerprint,
- enabled/disabled state.

## Execution model

1. GitHub webhook creates a release run.
2. App decides runner mode from installation/repository policy.
3. In `github-actions` mode, workflow dispatch continues as today.
4. In `self-hosted` mode, run remains queued until a registered runner claims it.
5. Runner posts signed result callback to the hosted app.
6. App updates check-run output, PR comment, findings, and dashboard state.

## Safe-mode expectations

Self-hosted mode should respect the same safe-mode metadata used for private repositories and fork PRs:

- private repositories,
- fork pull requests,
- draft pull requests,
- any repository policy that requires advisory-only execution.

## Acceptance criteria

- Deployment docs describe available runner modes.
- Environment variables define the default mode and self-hosted label.
- The app can later choose dispatch behavior without changing webhook normalization.
- Self-hosted mode does not require exposing repository secrets to fork code.
