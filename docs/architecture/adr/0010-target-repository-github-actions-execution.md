# ADR-0010: Target-repository GitHub Actions execution

- **Status:** Accepted
- **Date:** 2026-07-15
- **Supersedes:** The central dispatch-repository assumption in ADR-0009 for the default hosted execution path
- **Retains:** ADR-0009 customer self-hosted runner protocol as an optional enterprise execution mode

## Context

BoardReadyOps Cloud needs to run KiCad checks for public and private GitHub repositories without keeping a BoardReadyOps-operated KiCad worker online. The earlier GitHub Actions implementation dispatched a workflow in a separately configured runner repository. That design worked only when the target repository and runner repository were accessible to the same GitHub App installation. A customer installation token cannot cross into an unrelated BoardReadyOps-owned repository.

Running private customer source in a public central workflow repository would also put workflow logs and artifacts in the wrong repository boundary. Using `ops-vps-03` as the default worker would require continuously operating a privileged execution host and would move source execution away from the repository owner's existing GitHub Actions controls and quota.

## Decision

The default hosted execution backend is GitHub Actions in the repository being analyzed.

Each enabled repository keeps `.github/workflows/readiness-runner.yml` on its default branch. The GitHub App installation token dispatches that workflow in the same repository that produced the pull request webhook. The workflow:

1. accepts a run ID, execution-attempt ID, repository name, exact commit SHA, callback URL, and normalized safety metadata;
2. rejects a target that is not equal to `github.repository`;
3. checks out and verifies the exact assigned commit SHA without persisting checkout credentials;
4. installs the supported KiCad CLI line and runs the pinned BoardReadyOps Action;
5. keeps source, logs, and GitHub Actions artifacts in the target repository;
6. obtains a short-lived GitHub Actions OIDC token bound to the run and execution attempt; and
7. posts only normalized findings, metrics, and the workflow-run link to the control plane.

The control plane validates the OIDC token against database-authoritative values for:

- target repository;
- workflow file;
- target repository default branch;
- `workflow_dispatch` event;
- GitHub-hosted runner environment;
- release-run ID; and
- current execution-attempt ID.

No long-lived BoardReadyOps callback secret is stored in the target repository. The GitHub App does not receive Contents access for this mode; the workflow's job-scoped `GITHUB_TOKEN` receives `contents: read` only.

## Consequences

### Positive

- `ops-vps-03` is no longer required for the default hosted product path.
- Public repositories use GitHub-hosted execution without BoardReadyOps worker capacity.
- Private repository source, logs, checkout credentials, and workflow artifacts remain in the customer's repository boundary.
- GitHub Actions usage is charged to the repository owner's account rather than a shared BoardReadyOps worker.
- The App can remain least privilege with Metadata read, Pull requests read, Checks write, and Actions write.
- The control plane remains a lightweight webhook, state, dashboard, and result-publication service suitable for serverless/container PaaS deployment.

### Negative

- Every repository must install the dispatch workflow on its default branch before the App can execute checks.
- Private repositories consume the owner's GitHub Actions minutes and storage quota.
- Cold runner startup and KiCad package installation increase execution latency.
- GitHub Actions outages or disabled Actions settings prevent execution.
- This is not a one-click zero-file onboarding model because the App intentionally lacks Contents write permission.

## Rejected alternatives

### BoardReadyOps-operated VPS worker as the default

Rejected because it creates a persistent operations, patching, isolation, and capacity obligation. It remains available only as the customer self-hosted/enterprise mode defined by ADR-0009.

### Central BoardReadyOps workflow repository

Rejected because installation tokens cannot cross installation boundaries and private customer logs/artifacts would be retained in the wrong repository.

### Grant the App Contents write to install workflows automatically

Rejected because workflow installation does not justify a broad source-write permission. Repository owners install and review the workflow explicitly.

### Run KiCad inside the cloud control plane

Rejected because serverless control-plane runtimes are not the correct trust, filesystem, or resource boundary for repository checkout and KiCad execution.

## Rollout

1. Merge and deploy the target-repository dispatch and dynamic OIDC callback support.
2. Configure `BOARDREADYOPS_RUNNER_MODE=github-actions` and `BOARDREADYOPS_DISPATCH_WORKFLOW=readiness-runner.yml`.
3. Update the production GitHub App to Actions read/write and re-authorize installations.
4. Add the reviewed workflow and `boardreadyops.yml` to each target repository default branch.
5. Validate public and private pull requests end to end.
6. Keep self-hosted runner registrations disabled unless a customer explicitly selects that execution mode.
