# Synthetic Target-Repository Canaries

BoardReadyOps uses two dedicated GitHub repositories to prove that the production target-repository execution path works for both public and private installations. Each observation updates a persistent pull request with one deterministic nonce commit, waits for the BoardReadyOps Check Run on the exact nonce SHA, and verifies the target repository's `readiness-runner.yml` workflow run.

The canaries exercise this complete path:

```text
scheduled repository workflow
  -> repository-local nonce commit and persistent pull request
  -> pull_request webhook
  -> BoardReadyOps lifecycle job and outbox
  -> target-repository workflow_dispatch
  -> exact target SHA checkout and KiCad execution
  -> attempt-bound GitHub Actions OIDC callback
  -> terminal BoardReadyOps Check Run publication
  -> repository-local bounded verification
```

They do not call a control-plane database or internal API directly. A direct probe would bypass the GitHub App installation, webhook intake, workflow dispatch, OIDC callback, and Check Run publication boundaries that the canary is intended to validate.

## Repository inventory

Provision exactly these repositories under the `oaslananka-dev` organization:

| Repository | Required visibility | Schedule |
| --- | --- | --- |
| `oaslananka-dev/boardreadyops-canary-public` | public | `17 */6 * * *` |
| `oaslananka-dev/boardreadyops-canary-private` | private | `47 */6 * * *` |

The stagger keeps the two observations from starting together while providing four public and four private observations per day.

Each repository must contain:

```text
.github/workflows/boardreadyops-canary.yml
.github/workflows/readiness-runner.yml
boardreadyops.yml
canary/nonce.txt
hardware/canary.kicad_pro
hardware/canary.kicad_sch
hardware/canary.kicad_pcb
```

The hardware project must be small, deterministic, and expected to pass. A deliberately failing policy result would make platform failure indistinguishable from an intentional product-policy failure.

## Security boundary

The production BoardReadyOps GitHub App receives no new GitHub App permission. It keeps the ordinary target-repository profile: Metadata read, Pull requests read, Checks read/write, and Actions read/write. The App still has no Contents write permission. No organization or account permissions are permitted.

Before installation, verify the live App registration rather than relying only on repository documentation. The requested permissions and subscribed events must match the deployed execution profile in [GitHub App permissions and webhook subscriptions](../security/github-app-permissions.md). Do not install the App when the live registration requests Contents, repository administration, organization, account, secret, workflow, or unrelated write access. Stop commissioning and keep [#88](https://github.com/oaslananka/boardreadyops/issues/88) open until the external registration is reduced and reviewed.

The scheduled canary workflow uses the caller repository's short-lived `GITHUB_TOKEN` with only:

```yaml
permissions:
  actions: read
  checks: read
  contents: write
  pull-requests: write
```

There is no long-lived personal access token, callback secret, GitHub App private key, or BoardReadyOps API key in either canary repository. The repository token can mutate and observe only its own repository. The reusable workflow is pinned to the exact BoardReadyOps commit that contains the reviewed implementation.

When this token opens or updates the persistent pull request, GitHub creates the `pull_request` event. Ordinary pull request workflows may enter an approval-required state. The canary does not depend on those ordinary pull request workflows; it depends on the BoardReadyOps GitHub App webhook and the separate target-repository `workflow_dispatch` started by the control plane.

Private source, workflow logs, and artifacts remain in `oaslananka-dev/boardreadyops-canary-private`. Canary summaries contain repository identity, expected SHA, elapsed time, stable reason code, and known Check Run or workflow URLs only. They do not contain source, findings, artifact names, webhook payloads, credentials, OIDC claims, installation tokens, or raw GitHub response bodies.

## Public repository wrapper

Create `.github/workflows/boardreadyops-canary.yml` in `oaslananka-dev/boardreadyops-canary-public`:

```yaml
name: BoardReadyOps Public Synthetic Canary

on:
  schedule:
    - cron: "17 */6 * * *"
  workflow_dispatch:

permissions:
  actions: read
  checks: read
  contents: write
  pull-requests: write

concurrency:
  group: boardreadyops-synthetic-canary
  cancel-in-progress: false

jobs:
  canary:
    uses: oaslananka/boardreadyops/.github/workflows/synthetic-target-repository-canary.yml@d93cff3819ffcbbff97ac9600f71a27844c4d005 # BoardReadyOps canary workflow
    with:
      visibility: public
      public-origin: ${{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}
```

## Private repository wrapper

Create `.github/workflows/boardreadyops-canary.yml` in `oaslananka-dev/boardreadyops-canary-private`:

```yaml
name: BoardReadyOps Private Synthetic Canary

on:
  schedule:
    - cron: "47 */6 * * *"
  workflow_dispatch:

permissions:
  actions: read
  checks: read
  contents: write
  pull-requests: write

concurrency:
  group: boardreadyops-synthetic-canary
  cancel-in-progress: false

jobs:
  canary:
    uses: oaslananka/boardreadyops/.github/workflows/synthetic-target-repository-canary.yml@d93cff3819ffcbbff97ac9600f71a27844c4d005 # BoardReadyOps canary workflow
    with:
      visibility: private
      public-origin: ${{ vars.BOARDREADYOPS_CLOUD_ORIGIN }}
```

Do not change the pin to a branch or tag. Upgrade it only after reviewing a newer BoardReadyOps commit and manually commissioning both repositories.

## One-time provisioning

For each repository:

1. Verify the repository name and public/private visibility exactly match the inventory table.
2. Verify the live App registration matches the documented least-privilege profile and has no organization or account permissions.
3. Install the production BoardReadyOps GitHub App on only the two canary repositories.
4. Confirm the installation has Metadata read, Pull requests read, Checks read/write, and Actions read/write, with no Contents permission.
5. Add the reviewed `readiness-runner.yml` to the default branch at `.github/workflows/readiness-runner.yml`.
6. Add a minimal passing KiCad project and `boardreadyops.yml` to the default branch.
7. Add `canary/nonce.txt` with an initial informational value.
8. Set the non-secret repository variable `BOARDREADYOPS_CLOUD_ORIGIN` to the reviewed deployed BoardReadyOps HTTPS origin. Do not commission a canary until that origin is selected and reachable.
9. Enable GitHub Actions for the repository and allow the pinned actions used by both workflows.
10. Enable the repository setting that allows GitHub Actions to create and approve pull requests. If an organization policy blocks this repository setting, change the organization policy only after checking the effective setting on every other organization repository.
11. Add the appropriate wrapper shown above.
12. Confirm the default branch is `main` and no existing branch or pull request uses the fixed `boardreadyops-canary` identity for another purpose.

The canary workflow creates or reuses the `boardreadyops-canary` branch and a persistent pull request titled `chore: BoardReadyOps synthetic canary`. Every run creates one commit whose parent is the current `main` commit and changes only `canary/nonce.txt`.

## Commissioning

Run each wrapper manually through `workflow_dispatch` before relying on its schedule.

A successful commissioning run proves all of the following:

1. The caller workflow can create the nonce commit and persistent pull request.
2. GitHub delivers the pull request webhook to the production BoardReadyOps App installation.
3. BoardReadyOps creates a Check Run on the exact nonce SHA.
4. The control plane dispatches `readiness-runner.yml` in the same repository.
5. The target workflow runs with event `workflow_dispatch`.
6. The exact target commit is checked out and evaluated with KiCad.
7. The attempt-bound OIDC callback is accepted.
8. The Check Run reaches `completed / success`.
9. The Check Run `external_id` contains the authoritative lowercase UUID release-run identifier.
10. The Check Run details URL uses the configured BoardReadyOps HTTPS origin.
11. The Check Run Reports section identifies the successful target-repository Actions run.

Record the wrapper workflow URL, expected nonce SHA, BoardReadyOps Check Run URL, target readiness workflow URL, elapsed time, repository visibility, and commissioning date. Do not copy findings, source, logs, tokens, or OIDC claims into the commissioning record.

## Stable failure reasons

| Reason | Meaning | First operator check |
| --- | --- | --- |
| `canary_pr_update_failed` | Repository identity, visibility, branch, commit, or persistent PR mutation did not converge. | Verify repository visibility, Actions PR creation settings, and repository token permissions. |
| `canary_check_run_missing` | No matching BoardReadyOps Check Run appeared on the exact nonce SHA before the bounded wait ended. | Verify webhook delivery, App installation scope, release allow-list, and lifecycle worker health. |
| `canary_check_run_timeout` | The exact-SHA Check Run appeared but did not reach a terminal state. | Check lifecycle, outbox, callback, and Check Run reconciliation signals. |
| `canary_check_run_failed` | The exact-SHA Check Run completed with a non-success conclusion. | Open the safe Check Run summary and target workflow status; distinguish policy failure from execution failure. |
| `canary_check_run_binding_invalid` | Repository, SHA, Check Run name, release UUID, origin, workflow ID, or event binding did not match. | Treat as a security-sensitive integrity failure and preserve the URLs and expected SHA. |
| `canary_workflow_missing` | The Check Run did not identify the expected target workflow or the workflow/run could not be found. | Confirm `readiness-runner.yml` exists on `main` and the App has Actions access. |
| `canary_workflow_timeout` | The referenced target workflow was observed but did not finish within the bounded wait. | Check GitHub Actions queue health, organization policies, and KiCad installation progress. |
| `canary_workflow_failed` | The target readiness workflow completed unsuccessfully. | Inspect only the repository-local workflow status needed for diagnosis; do not copy private logs into control-plane telemetry. |
| `canary_github_api_unavailable` | A bounded GitHub API call failed, returned an unsupported status, invalid JSON, or exceeded the request cap. | Check GitHub status, API rate limits, and repository token availability. |

## Incident diagnosis

For any failed canary:

1. Preserve the stable reason code, repository visibility, expected SHA, elapsed time, and known URLs.
2. Check GitHub status for Actions, Checks, webhooks, and API incidents.
3. Confirm `/health/ready` reports healthy database access and advancing worker timestamps.
4. Review the latest privacy-safe `worker.control_plane_slo_evaluation` and any firing transition.
5. Correlate `worker.reconciliation_detected`, `worker.reconciliation_terminal`, Check Run reconciliation events, and lifecycle reconciliation events by safe identifiers only.
6. Confirm the target repository still has the reviewed default-branch workflow and the GitHub App installation remains authorized.
7. For a missing Check Run, inspect webhook intake and lifecycle queue acceptance before considering replay.
8. For a pending or stale target workflow, follow the missed-callback reconciliation procedure.
9. For Check Run publication drift, follow the Check Run reconciliation procedure; the accepted signed result remains authoritative.
10. Retry with `workflow_dispatch` only after the suspected configuration or service condition is corrected.

Do not fix a canary by granting the production App Contents write, moving private source to a central workflow repository, bypassing OIDC, fabricating a Check Run, manually changing a release result, or enabling a persistent BoardReadyOps-operated KiCad worker.

## Recovery and upgrade

After recovery:

1. Run the affected repository manually and confirm success.
2. Run the other visibility class manually to ensure the fix did not cross tenant boundaries.
3. Confirm the next scheduled run succeeds.
4. Record the recovery transition and related aggregate SLO recovery signal.
5. Close the incident only after both control-plane health and target-repository evidence have converged.

To upgrade the reusable workflow pin, review the new BoardReadyOps commit, update one canary repository, run it manually, then update and run the other repository. Keep the old pin available for rollback until both commissioning runs pass.

## Retirement

Before deleting or replacing a canary repository:

1. disable its schedule;
2. record the final successful observation;
3. remove the repository from production release allow-lists;
4. uninstall the BoardReadyOps App from that repository;
5. archive the incident and commissioning references without private content; and
6. provision and commission the replacement visibility class before relying on it for GA evidence.
