# Synthetic target-repository canaries design

## Goal

Complete the remaining issue #190 slice by continuously proving that the default hosted execution path works for both a public and a private target repository:

```text
scheduled nonce update
  -> pull request synchronize webhook
  -> BoardReadyOps control-plane inbox and lifecycle job
  -> target-repository workflow_dispatch
  -> exact-SHA checkout and KiCad execution
  -> attempt-bound GitHub Actions OIDC callback
  -> persisted terminal result
  -> completed BoardReadyOps Check Run
```

The canaries must not depend on `ops-vps-3`, another persistent KiCad worker, a cross-repository personal access token, or Contents write permission on the production BoardReadyOps GitHub App.

This delivery also removes a reproducible test-isolation defect discovered while preparing the canary work: `runFixture()` currently executes directly against tracked fixture directories, allowing KiCad to create untracked `.kicad_prl` session files inside the repository.

## Scope

### In `oaslananka/boardreadyops`

- Make rule fixtures immutable during tests by running `runFixture()` against a temporary recursive copy.
- Add regression coverage proving a fixture run does not create or modify files under `tests/fixtures/projects`.
- Add a pinned reusable target-repository canary workflow that performs the nonce mutation and verification in the caller repository.
- Add static tests for workflow permissions, cadence inputs, bounded polling, and required validation steps.
- Add an operations runbook covering provisioning, expected signals, diagnosis, recovery, and retirement.
- Link the canary procedure from the GitHub Actions execution and control-plane reconciliation documentation.

### Dedicated repositories

Provision these repositories under the `oaslananka` account:

- `oaslananka/boardreadyops-canary-public`, public visibility.
- `oaslananka/boardreadyops-canary-private`, private visibility.

Each repository contains one minimal passing KiCad project, `boardreadyops.yml`, the reviewed `.github/workflows/readiness-runner.yml`, and the synthetic canary workflow defined by this design.

## Chosen approach

Each canary repository owns a thin scheduled wrapper workflow. The wrapper calls a reusable workflow from `oaslananka/boardreadyops` pinned to the exact merge commit that introduced the canary implementation. The reusable workflow runs in the caller repository context and uses that repository's short-lived `GITHUB_TOKEN` to create or reuse a persistent `boardreadyops-canary` branch and pull request, write a unique nonce commit, and then poll GitHub for the BoardReadyOps Check Run attached to the new commit.

This is preferred over a central scheduler because:

- no long-lived personal access token is needed;
- no separate cross-repository automation App is needed;
- the production BoardReadyOps App keeps its accepted least-privilege profile and does not gain Contents write;
- public and private behavior is exercised inside the repository boundary that owns the source, logs, Actions minutes, and artifacts; and
- a canary failure is visible as a normal GitHub Actions workflow failure in the affected repository.

A direct API or database probe is rejected because it would bypass pull-request webhook delivery, GitHub App installation scope, workflow dispatch, exact-SHA checkout, OIDC result authentication, and Check Run publication.

## Canary repository contract

Each canary repository has the following stable files:

```text
.github/workflows/readiness-runner.yml
.github/workflows/boardreadyops-canary.yml
boardreadyops.yml
canary/nonce.txt
hardware/canary.kicad_pro
hardware/canary.kicad_sch
hardware/canary.kicad_pcb
```

The hardware project is intentionally small and deterministic. Its policy result must be `pass`; an expected blocking finding would make infrastructure failure indistinguishable from product-policy failure.

The default branch is `main`. The persistent head branch is `boardreadyops-canary`. The persistent pull request title is `chore: BoardReadyOps synthetic canary`.

The BoardReadyOps GitHub App is installed on both repositories with the same production permission profile used by ordinary target repositories. Two-installation adversarial isolation remains issue #154 and is not duplicated here.

## Schedule and concurrency

The public canary runs every six hours at minute 17. The private canary runs every six hours at minute 47. The stagger prevents both repositories from consuming control-plane and GitHub Actions resources simultaneously while providing four observations per repository per day.

The workflow also supports `workflow_dispatch` for commissioning and incident diagnosis.

Each repository uses a single concurrency group with `cancel-in-progress: false`. A new schedule occurrence must not cancel an existing observation because cancellation would create an ambiguous canary result and could itself trigger lifecycle reconciliation.

## Mutation flow

The synthetic workflow declares only the repository-local permissions it needs:

```yaml
permissions:
  actions: read
  checks: read
  contents: write
  pull-requests: write
```

The pinned reusable workflow:

1. reads the current `main` commit and tree through GitHub's API;
2. creates a blob containing an ISO-8601 timestamp, the synthetic workflow run ID, and run attempt;
3. creates a tree based on the current `main` tree with only `canary/nonce.txt` replaced;
4. creates one commit whose parent is the current `main` commit;
5. creates or force-updates `refs/heads/boardreadyops-canary` to that commit;
6. creates the persistent pull request if it does not already exist;
7. records the exact pushed SHA; and
8. verifies convergence for that repository and SHA.

Using the Git Data API avoids persisting checkout credentials and ensures each observation is one deterministic commit based on the current default branch.

The repository setting that permits GitHub Actions to create pull requests must be enabled. The canary does not depend on ordinary pull-request workflows started by the nonce commit. Its required execution is the separate `workflow_dispatch` started by the BoardReadyOps GitHub App after webhook acceptance.

## Verification contract

The verifier inside the reusable workflow uses GitHub's API through the caller repository `GITHUB_TOKEN`. It accepts:

- repository name;
- exact expected head SHA;
- expected Check Run name, defaulting to `BoardReadyOps / release readiness`;
- expected readiness workflow filename, defaulting to `readiness-runner.yml`;
- expected BoardReadyOps public origin;
- total timeout, defaulting to 20 minutes; and
- polling interval, defaulting to 15 seconds.

It performs bounded polling and succeeds only when all of these conditions are true:

1. A Check Run named `BoardReadyOps / release readiness` exists on the exact nonce SHA.
2. The Check Run reaches `completed` before the timeout.
3. Its conclusion is `success`.
4. Its `external_id` is a lowercase UUID identifying the authoritative BoardReadyOps release run.
5. Its details URL uses HTTPS and the configured BoardReadyOps public origin.
6. The Check Run summary's Reports section contains a GitHub Actions run URL for the same target repository.
7. The referenced workflow run belongs to the same repository, has event `workflow_dispatch`, resolves to the workflow ID for `readiness-runner.yml`, reaches `completed`, and concludes successfully.

A successful Check Run on the exact nonce SHA proves that the signed terminal result was accepted and publication converged. The referenced Actions run proves that the result came from the target-repository readiness workflow rather than a stale or unrelated Check Run. The verifier does not compare the workflow run's `head_sha` to the nonce SHA because a `workflow_dispatch` run is associated with the dispatched workflow ref on the default branch; the target commit is instead bound by the Check Run head SHA, the dispatch input validation, and the control plane's attempt-bound OIDC checks.

The verifier never reads workflow logs, source contents beyond the known nonce commit, findings, artifacts, control-plane database records, installation credentials, or OIDC tokens. It parses only the fixed Reports section needed to identify the target-repository Actions run.

## Failure classification

The synthetic workflow emits a stable failure summary using one of these public reason codes:

- `canary_pr_update_failed`
- `canary_check_run_missing`
- `canary_check_run_timeout`
- `canary_check_run_failed`
- `canary_check_run_binding_invalid`
- `canary_workflow_missing`
- `canary_workflow_timeout`
- `canary_workflow_failed`
- `canary_github_api_unavailable`

The summary contains repository visibility, expected SHA, elapsed time, workflow URL when known, Check Run URL when known, and the fixed reason code. It must not contain source, findings, artifact names, webhook payloads, credentials, OIDC claims, or raw response bodies.

GitHub Actions workflow failure is the initial alert source. Repository notification or organization-level Actions monitoring must route failures to the same operator destination used for control-plane SLO alerts. The runbook defines how to correlate a canary failure with SLI snapshots, worker readiness, reconciliation events, GitHub status, and target-repository Actions state.

## Test-fixture isolation

`tests/unit/rules/helpers.ts::runFixture()` will call `copyFixture()` and pass the temporary path to `runPipeline()` instead of passing the tracked fixture path directly.

A regression test will:

1. require a clean source fixture state with no generated `.kicad_prl` files;
2. snapshot the source fixture file lists and content digests;
3. execute both package-completeness fixture paths through `runFixture()`;
4. assert the expected rule results; and
5. assert the source fixture snapshots are unchanged and no `.kicad_prl` file appeared.

The regression test must not clean or rewrite the source fixtures itself; a dirty checkout is a test failure, not test setup.

Temporary fixture cleanup is best-effort and must not mask the pipeline assertion if cleanup fails. Existing helpers already use temporary directories without central lifecycle ownership; this slice does not introduce a broader temporary-directory framework.

## Security and privacy

- The production BoardReadyOps GitHub App receives no new permission.
- The canary repository `GITHUB_TOKEN` is short-lived, scoped to its own repository, and passed to a reusable workflow pinned by full commit SHA.
- Private source, logs, and artifacts remain in the private canary repository.
- The control plane receives only the normal normalized result contract.
- Canary status output contains no tenant payload, design content, findings, credentials, or raw GitHub responses.
- Branch and pull-request names are fixed; repository, SHA, Check Run, workflow, and URL comparisons are exact.
- Polling is bounded by both duration and request count.
- A successful public canary cannot satisfy the private canary, and vice versa, because each workflow queries only its own repository and exact SHA.

## Operations and recovery

The runbook will define:

- one-time repository creation and visibility verification;
- GitHub App installation and permission verification;
- Actions policy and pull-request creation setting verification;
- initial manual commissioning with `workflow_dispatch`;
- expected webhook, queue, dispatch, callback, Check Run, and reconciliation signals;
- diagnosis by stable failure reason;
- safe rerun and persistent-branch repair;
- readiness workflow version drift checks;
- temporary disablement during a declared GitHub or KiCad package outage; and
- retirement without changing production App permissions.

A canary is commissioned only after two consecutive manual successes and one scheduled success. Issue #190 can be closed only after both repositories meet that condition and the evidence links are recorded in the issue.

## Testing

### Automated repository tests

- A failing regression test first demonstrates that `runFixture()` mutates tracked fixture directories when real KiCad is available.
- The helper change makes the regression pass.
- Existing package-completeness tests continue to pass against copied fixtures.
- Reusable-workflow verifier tests cover delayed discovery, successful convergence, wrong SHA, wrong Check Run name, invalid external ID, wrong origin, missing or malformed Actions run links, wrong workflow ID, failed workflow, GitHub rate-limit/transient failures, and timeout.
- Workflow static tests verify `workflow_call`, wrapper trigger definitions, exact caller permissions, full-SHA pinning, non-cancelling concurrency, nonce contents, persistent branch and PR names, and bounded verifier arguments.
- Root lint, typecheck, full unit tests, strict docs build, and the existing cloud build checks pass.

### Commissioning evidence

For each dedicated repository, record:

- repository visibility and App installation ID;
- persistent pull request URL;
- nonce commit SHA;
- accepted webhook delivery ID;
- BoardReadyOps release run ID;
- target-repository readiness workflow URL;
- completed Check Run URL and conclusion;
- control-plane timeline timestamps; and
- confirmation that no checkout exists on `ops-vps-3`.

Private-repository evidence must not expose source, findings, artifacts, logs, or credentials.

## Out of scope

- Two unrelated GitHub installations or owners; tracked by issue #154.
- Fork pull-request adversarial validation; tracked by issue #42 and issue #154.
- Backup, restore, load, soak, and failure injection; tracked by issue #222.
- A BoardReadyOps-managed shared KiCad worker.
- A new durable incident database or dashboard UI.
- Granting Contents write to the production BoardReadyOps GitHub App.
- Using canary repositories as customer demos or product examples.
