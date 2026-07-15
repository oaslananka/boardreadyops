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

into the same path on the target repository's default branch. The target repository also needs a reviewed `boardreadyops.yml` because the pinned compatibility Action treats that path as an explicit configuration file. The workflow defaults to `https://boardreadyops.oaslananka.dev`; a staging repository may set the repository variable `BOARDREADYOPS_CLOUD_ORIGIN` to another HTTPS origin.

Do not place the workflow only on a pull request branch. GitHub's workflow-dispatch endpoint resolves workflow files from the repository default branch.

## Workflow permissions

The job declares only:

```yaml
permissions:
  contents: read
  id-token: write
```

`contents: read` belongs to the workflow's short-lived `GITHUB_TOKEN`, not the GitHub App installation token. `id-token: write` permits the workflow to request a short-lived OIDC token for the result callback. No `BOARDREADYOPS_API_KEY`, runner callback secret, GitHub personal access token, or App private key is stored in the repository.

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
BOARDREADYOPS_PUBLIC_URL=https://boardreadyops.oaslananka.dev
BOARDREADYOPS_RELEASE_REPOSITORIES=owner/repository
```

To keep the rollout allow-list outside the secret-bearing runtime environment, store one repository per line in a non-secret policy file and deploy with `BOARDREADYOPS_CLOUD_RELEASE_REPOSITORIES_FILE=/opt/boardreadyops-cloud/release-repositories`. The deployer mounts it read-only as `BOARDREADYOPS_RELEASE_REPOSITORIES_FILE`; a configured file takes precedence and fails closed if it cannot be read or exceeds 64 KiB.

Repositories containing multiple KiCad fixtures or projects can set the non-secret repository variable `BOARDREADYOPS_PROJECT` to one project directory or `.kicad_pro` path. Repositories whose configuration file is not at the root can set `BOARDREADYOPS_CONFIG` to that file. When unset, BoardReadyOps scans every discovered project and uses `boardreadyops.yml`.

Do not configure a central dispatch repository. The control plane always dispatches the workflow in the repository associated with the release run and uses that repository's persisted default branch.

The callback endpoint is:

```text
POST /api/v1/runs/github-actions-result?run_id=<uuid>&attempt_id=<uuid>
```

The endpoint accepts GitHub Actions OIDC only. It resolves the expected repository, workflow file, default branch, run ID, and execution-attempt ID from PostgreSQL before verifying the token. It then delegates to the normal result persistence and Check Run publication path.

## Execution behavior

The shipped workflow:

1. requires lowercase UUID run and execution-attempt IDs;
2. requires `target` to equal `github.repository`;
3. accepts only a full lowercase 40-character commit SHA;
4. pins the callback to the repository-controlled `BOARDREADYOPS_CLOUD_ORIGIN` HTTPS origin (production by default) and the exact run/attempt URL;
5. checks out the exact commit with persisted credentials disabled;
6. verifies the resulting Git SHA;
7. installs and verifies KiCad 10.0.x;
8. runs the exact BoardReadyOps v1.13.0 Action commit;
9. uploads JSON, SARIF, and Markdown reports as GitHub Actions artifacts;
10. maps the JSON report to the version-one cloud result contract; and
11. obtains an OIDC token with audience `boardreadyops-cloud:<run-id>:<attempt-id>` and retries the callback up to three times.

Blocking findings complete the cloud run with decision `fail` and fail the GitHub Actions workflow. Operational errors complete it with decision `error` when a callback can be sent.

## Quota and ownership

GitHub-hosted compute minutes and Actions artifact storage belong to the target repository owner. BoardReadyOps Cloud does not provide shared KiCad compute in this mode. Public and private repository billing behavior follows the owner's GitHub plan and organization policy.

Repository administrators must permit GitHub Actions and the pinned third-party actions used by the workflow. Organizations with an allow-list must allow:

- `actions/checkout` at the pinned commit;
- `actions/github-script` at the pinned commit; and
- `oaslananka/boardreadyops` at the pinned release commit.

## Commissioning checklist

1. Add the GitHub App installation to the target repository.
2. Confirm the installation has Actions read/write and Checks read/write.
3. Add `boardreadyops.yml` and `.github/workflows/readiness-runner.yml` to the default branch.
4. Confirm Actions are enabled and the organization policy permits the pinned actions.
5. Open or synchronize a non-draft, same-repository pull request.
6. Verify the BoardReadyOps Check Run becomes queued and then in progress.
7. Verify the target repository receives a `BoardReadyOps Readiness Runner` workflow run.
8. Verify checkout resolved to the assigned SHA and KiCad 10.0.x ran.
9. Verify the OIDC callback completes the Check Run and the dashboard shows findings and the Actions run link.
10. Verify no target checkout exists on the control-plane host or `ops-vps-03`.

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
