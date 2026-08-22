# GitHub Actions execution mode

GitHub Actions is the default BoardReadyOps Cloud execution backend. KiCad checks run in the repository being analyzed; the cloud service handles GitHub App webhooks, Check Runs, run state, dashboards, and authenticated result ingestion.

`ops-vps-03` or another BoardReadyOps-operated KiCad worker is not required for this mode. Customer self-hosted runners remain an optional enterprise mode.

## Topology

```text
pull_request webhook
  -> BoardReadyOps Cloud control plane
  -> target repository workflow_dispatch
  -> GitHub-hosted ubuntu runner
       -> exact commit checkout
       -> KiCad 10 + pinned BoardReadyOps Action
       -> GitHub workflow artifacts
       -> run/attempt-bound GitHub OIDC callback
  -> BoardReadyOps Cloud persists findings and completes the Check Run
```

The workflow runs in the target repository. Private source, workflow logs, checkout credentials, and GitHub Actions artifacts do not move to a central BoardReadyOps runner repository or control-plane filesystem.

## Repository prerequisite

Copy the reviewed workflow from:

```text
.github/workflows/readiness-runner.yml
```

into the same path on the target repository's default branch. The target repository also needs a reviewed `boardreadyops.yml` because the pinned compatibility Action treats that path as an explicit configuration file. Set the non-secret repository variable `BOARDREADYOPS_CLOUD_ORIGIN` to the deployed BoardReadyOps control-plane HTTPS origin before dispatch. There is no baked-in production origin; a missing or non-HTTPS value fails closed before an OIDC callback is attempted.

Do not place the workflow only on a pull request branch. GitHub's workflow-dispatch endpoint resolves workflow files from the repository default branch.

### Guided repository setup and readiness probe

The hosted setup preview is available at `/setup`. It presents four versioned policy presets—open-source hardware, prototype fabrication, production release, and contract-design handoff—plus the exact proposed `boardreadyops.yml`, workflow path, permissions, and review steps. Selecting or switching a preset appends a new setup revision; it never rewrites prior setup history.

Configure `/setup` as the GitHub App [Setup URL](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url) and enable redirect-on-update. GitHub supplies an untrusted `installation_id` query parameter after installation or repository-selection changes. The public page never displays or authorizes from that value; repository-specific setup state remains behind the authenticated operator API.

The operator API exposes the persisted setup state at:

```text
GET|POST /api/v1/operator/installations/<installation-id>/repositories/<repository-id>/setup
```

`POST` supports idempotent `select_preset` and `probe` actions. A probe first reads the target workflow metadata through the installation-scoped App token using the existing Actions permission; it does not call the Administration-only repository Actions settings endpoint. When the workflow is active, the control plane dispatches a 15-minute setup probe in the target repository. The probe checks out the repository default branch with persisted credentials disabled, validates `boardreadyops.yml` using a pinned CLI, and posts only bounded status metadata to:

```text
POST /api/v1/setup-probes/result?probe_id=<uuid>
```

The callback accepts GitHub Actions OIDC only. Verification binds the token to the repository full name and numeric repository ID, `.github/workflows/readiness-runner.yml`, the persisted default-branch ref, and the exact probe audience. Missing workflow, disabled Actions, incompatible workflow metadata, missing configuration, invalid configuration, expired probe, stale probe, and dispatch failure remain distinct states.

Every accepted release run snapshots the effective setup revision. Later preset changes therefore do not alter the policy provenance shown for historical runs.

## Workflow permissions

The job declares only:

```yaml
permissions:
  actions: read
  checks: read
  contents: read
  id-token: write
```

These are job-scoped permissions for the workflow's short-lived repository `GITHUB_TOKEN`:

- `actions: read` — read historical BoardReadyOps workflow artifacts in this repository only;
- `checks: read` — read the App-created Check Run that binds this release run to its exact PR base SHA;
- `contents: read` — checkout the exact assigned commit; and
- `id-token: write` — obtain the short-lived OIDC token for the result callback.

This job permission change does **not** alter the production GitHub App permission profile below. No `BOARDREADYOPS_API_KEY`, runner callback secret, GitHub personal access token, or App private key is stored in the repository.


### Exact-base hardware-impact boundary

For PR-native hardware impact, the control plane records the webhook's exact PR base SHA in the queued BoardReadyOps Check Run. The target workflow reads that Check Run using its job-scoped `checks: read` permission and binds it to the exact release `run_id` and head SHA before comparison. No new `workflow_dispatch` input is required, so existing target workflows do not receive an unexpected input during rolling upgrades.

The Action then resolves the historical BoardReadyOps artifact only inside the same target repository and same workflow identity. If the exact base artifact is absent or invalid, it does not fall back to another run. Raw historical/current reports, source files, and workflow artifacts stay in the target repository. The OIDC callback may carry only the validated bounded `hardwareImpact` object; the control plane stores it inside the existing tenant-scoped terminal-result payload and uses it for Check Run/optional PR-comment rendering.

## GitHub App permissions

The target-repository Actions profile requires:

| Permission | Level | Purpose |
| --- | --- | --- |
| Metadata | Read | Installation and repository identity |
| Pull requests | Read | Receive supported pull request webhooks |
| Checks | Read and write | Create, start, and complete the BoardReadyOps Check Run |
| Actions | Read and write | Dispatch `.github/workflows/readiness-runner.yml` in the target repository |

Pull request comments are optional and require a separate reviewed write permission. The App does not need Contents access for this execution mode.

Changing requested App permissions requires existing installations to be re-authorized before workflow dispatch will succeed.

## Control-plane configuration

```env
BOARDREADYOPS_RUNNER_MODE=github-actions
BOARDREADYOPS_DISPATCH_WORKFLOW=readiness-runner.yml
BOARDREADYOPS_PUBLIC_URL=https://boardreadyops.example.com
BOARDREADYOPS_RELEASE_REPOSITORIES=owner/repository
```

To keep the rollout allow-list outside the secret-bearing runtime environment, store one repository per line in a non-secret policy file and deploy with `BOARDREADYOPS_CLOUD_RELEASE_REPOSITORIES_FILE=/opt/boardreadyops-cloud/release-repositories`. The deployer mounts it read-only as `BOARDREADYOPS_RELEASE_REPOSITORIES_FILE`; a configured file takes precedence and fails closed if it cannot be read or exceeds 64 KiB.

Repositories containing multiple KiCad fixtures or projects can set the non-secret repository variable `BOARDREADYOPS_PROJECT` to one project directory or `.kicad_pro` path. Repositories whose configuration file is not at the root can set `BOARDREADYOPS_CONFIG` to that file. When unset, BoardReadyOps scans every discovered project and uses `boardreadyops.yml`.

Do not configure a central dispatch repository. The control plane always dispatches the workflow in the repository associated with the release run and uses that repository's persisted default branch.

The callback endpoint is:

```text
POST /api/v1/runs/github-actions-result?run_id=<uuid>&attempt_id=<uuid>
```

The endpoint accepts GitHub Actions OIDC only. It resolves the expected repository, numeric repository ID, workflow file, default branch, exact commit SHA, run ID, execution-attempt ID, and immutable trust snapshot from PostgreSQL before verifying the token. It then delegates to the normal result persistence and Check Run publication path.

## Two-installation adversarial validation

The manual `target-repository-isolation` workflow provides the bounded database-backed adversarial proof required by ADR-0010 and the Cloud Control Plane Reliability milestone. It provisions an isolated PostgreSQL 16 service, creates two unrelated installations and repositories, signs short-lived test OIDC tokens with a disposable in-memory RSA key, and exercises the real GitHub Actions result callback and result-publication path. Run it from GitHub Actions or reproduce the same contract with `pnpm run cloud:isolation:verify` after applying migrations to a disposable database.

The validation proves that both installations can independently persist a result and complete only their own Check Run. It then rejects cross-installation run/attempt use, a stale attempt, modified repository, numeric repository ID, workflow, default-branch ref, exact commit SHA, event, runner-environment, and trust-snapshot claims. Rejected callbacks must produce zero database mutations, zero Check Run publication calls, and no other-tenant values in the response. The optional pull request comment path is deliberately unavailable for one fixture while Check Run completion succeeds with a non-blocking warning.

The uploaded `target-repository-isolation-report.json` is mode `0600` and aggregate-only. It records proof counts and invariant totals, never installation IDs, repository names, commit values, tokens, payloads, findings, artifacts, database URLs, or raw errors. This synthetic proof does not replace the live two-owner/two-installation commissioning run or least-privilege GitHub App permission evidence. Those production checks remain blocked by the re-authorization rollout tracked in issue #88; issue #154 stays open until that live evidence is complete.

## Execution behavior

The shipped workflow:

1. requires lowercase UUID run and execution-attempt IDs;
2. requires `target` to equal `github.repository`;
3. accepts only a full lowercase 40-character commit SHA;
4. pins the callback to the explicitly configured repository-controlled `BOARDREADYOPS_CLOUD_ORIGIN` HTTPS origin and the exact run/attempt URL;
5. checks out the exact commit with persisted credentials disabled;
6. verifies the resulting Git SHA;
7. installs and verifies KiCad 10.0.x;
8. runs the exact BoardReadyOps Action commit pinned in the reviewed workflow;
9. uploads JSON, SARIF, and Markdown reports as GitHub Actions artifacts;
10. maps the JSON report to the version-one cloud result contract; and
11. obtains an OIDC token with audience `boardreadyops-cloud:<run-id>:<attempt-id>` and retries the callback up to three times.

Blocking findings complete the cloud run with decision `fail` and fail the GitHub Actions workflow. Operational errors complete it with decision `error` when a callback can be sent.

## Quota and ownership

GitHub-hosted compute minutes and Actions artifact storage belong to the target repository owner. BoardReadyOps Cloud does not provide shared KiCad compute in this mode. Public and private repository billing behavior follows the owner's GitHub plan and organization policy.

The workflow's BoardReadyOps SHA is an execution-contract pin, not the public documentation recommendation. It may intentionally lag the latest public release while cloud callback, setup-probe, and result-contract compatibility are validated. Update that operational pin only with the workflow-specific tests and commissioning evidence; user-facing examples elsewhere use the latest reviewed public release commit.

Repository administrators must permit GitHub Actions and the pinned third-party actions used by the workflow. Organizations with an allow-list must allow:

- `actions/checkout` at the pinned commit;
- `actions/github-script` at the pinned commit; and
- `oaslananka/boardreadyops` at the pinned release commit.

## Commissioning checklist

1. Add the GitHub App installation to the target repository.
2. Confirm the installation has Actions read/write and Checks read/write.
3. Add `boardreadyops.yml` and `.github/workflows/readiness-runner.yml` to the default branch.
4. Set `BOARDREADYOPS_CLOUD_ORIGIN` to the reviewed deployed control-plane HTTPS origin.
5. Confirm Actions are enabled and the organization policy permits the pinned actions.
6. Open or synchronize a non-draft, same-repository pull request.
7. Verify the BoardReadyOps Check Run becomes queued and then in progress.
8. Verify the target repository receives a `BoardReadyOps Readiness Runner` workflow run.
9. Verify checkout resolved to the assigned SHA and KiCad 10.0.x ran.
10. Verify the OIDC callback completes the Check Run and the dashboard shows findings and the Actions run link.
11. Verify no target checkout exists on the control-plane host or `ops-vps-03`.

For continuous production-path validation across both repository visibility classes, provision and commission the [synthetic target-repository canaries](../operations/synthetic-target-repository-canaries.md).

## Failure modes

| Symptom | Likely cause |
| --- | --- |
| Dispatch API returns 404 | Workflow is missing from the target default branch or the configured filename differs |
| Dispatch API returns 403 | App installation lacks Actions write, Actions are disabled, or organization policy blocks dispatch |
| Checkout fails | Assigned SHA is unavailable to the repository's `GITHUB_TOKEN` |
| KiCad install fails | GitHub runner image or KiCad PPA is unavailable |
| Callback returns 401 | OIDC repository/workflow/ref/run/attempt claims do not match persisted state |
| Check remains in progress | Workflow stopped before callback or callback exhausted retries |
| Workflow fails with findings | BoardReadyOps correctly returned a blocking readiness decision |

Do not work around dispatch failures by granting the App Contents write, placing customer source in a central public workflow repository, or enabling a shared VPS worker without an explicit execution-mode decision.
