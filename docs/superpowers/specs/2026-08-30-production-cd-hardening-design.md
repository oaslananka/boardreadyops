# Production CD Hardening Design

## Context

BoardReadyOps production currently runs as the `boardreadyops-cloud` Docker Compose project on the commissioned host. The live web and worker containers are healthy, but the deployment checkout can drift from the image revision because there is no automatic release-to-host handoff. GitHub `main` has exact-SHA `ci` and `security` workflows, while production updates are still operator-driven.

The repository also contains the older documented `cloud:deploy:self-hosted` direct-Docker deploy primitive (`scripts/deploy-cloud.mjs`). That public/self-hosted path must remain backward-compatible. BoardReadyOps-operated production has converged on a Compose topology with Caddy, PostgreSQL, Redis, web, worker, and the operator-managed tunnel overlay, so production CD must not silently switch back to direct `bro-web` / `bro-worker` containers.

A prior hardening plan already defines a read-only `topology-preflight` maintenance operation. That prerequisite is required before production mutation because historical mixed Compose/direct-Docker ownership caused name conflicts and unsafe rollback behavior.

## Goals

- Automatically deploy a new `main` revision only after the exact revision has passed post-merge `ci` and `security` workflows.
- Require GitHub commit verification for the candidate revision.
- Keep production free of inbound deployment endpoints and long-lived GitHub-hosted SSH credentials.
- Fail closed on checkout/image drift, dirty production checkout, non-fast-forward candidates, topology drift, failed backup/restore verification, missing CI evidence, or unhealthy rollout.
- Run additive migrations before replacing live web/worker processes.
- Prove the new image through a local canary before live replacement.
- Roll back web and worker to the previous immutable image on rollout failure while retaining the forward-compatible database schema.
- Keep logs and GitHub-visible evidence free of runtime secrets, database URLs, tenant identifiers, findings, artifact paths, or raw API payloads.

## Non-goals

- Do not make arbitrary branches deployable.
- Do not deploy pull-request code directly to production.
- Do not add a GitHub self-hosted Actions runner to the production host.
- Do not add an SSH private key or production Docker credential to GitHub Actions secrets.
- Do not reverse database migrations automatically.
- Do not replace the public `cloud:deploy:self-hosted` interface in this change.
- Do not make the deployer repair topology drift automatically.

## Approaches considered

### GitHub-hosted workflow over SSH

This is operationally simple but places a long-lived production credential in GitHub and makes workflow code capable of reaching the host directly. Environment protection reduces but does not remove that blast radius. Rejected.

### Production self-hosted GitHub Actions runner

This avoids SSH credentials, but a repository-level runner on a public repository materially increases the attack surface. Even a constrained runner would execute repository-controlled workflow code on the production host. Rejected.

### Host-local pull deployer

A root-owned, timer-triggered deployer polls only outbound, resolves `origin/main`, and queries public GitHub metadata only when a new candidate exists. It deploys only after exact-SHA admission checks and uses the existing root/operator secret path locally. No inbound port, webhook, SSH key, or GitHub Actions runner is required. Chosen.

## Architecture

The production host gains a separate `boardreadyops-deployer` systemd oneshot service and timer. It is intentionally separate from `boardreadyops-maintenance`: maintenance remains a narrow read-only Unix-socket boundary, while deployment is privileged and mutating.

The deployer runs from an installed, root-owned copy under `/opt/boardreadyops-deployer`. Configuration is root-owned under `/etc/boardreadyops-deployer` and supplies the operator-selected deployment directory plus the public GitHub repository identity. The deployed source checkout remains under `<deployment-dir>/repo`; the existing local Compose wrapper under `<deployment-dir>/deploy.sh` remains responsible for ephemeral secret materialization and the fixed Compose project/files.

The timer runs no more frequently than every five minutes. It uses a non-blocking lock so overlapping deployment attempts cannot occur.

## Candidate admission

For each cycle:

1. Read current checkout SHA and require a clean worktree.
2. Read the current runtime status through `boardreadyops-maintenance runtime-status` and require `ready=true`; checkout SHA and running web image revision must match.
3. Fetch `origin/main` without moving the checkout and resolve the candidate SHA.
4. Exit successfully when candidate equals the current runtime revision.
5. Require current revision to be an ancestor of the candidate; automatic rollback or force-update of `main` is never followed.
6. Query GitHub's public API for the candidate commit and require `commit.verification.verified=true`.
7. Query exact-SHA workflow runs for `ci.yml` and `security.yml`. For each workflow, the newest `push` run for that SHA must be `completed` with `conclusion=success`.
8. If evidence is missing, pending, failed, cancelled, rate-limited, malformed, or unavailable, emit a bounded blocked category and perform no production mutation.

The public API is queried only when `origin/main` differs from the deployed revision, keeping anonymous GitHub API usage bounded. No GitHub token is required by the baseline design.

## Pre-deploy safety gate

Before moving the production checkout:

1. Run `boardreadyops-maintenance topology-preflight`; require `ready=true`.
2. Run `boardreadyops-maintenance backup-restore-verify`; require success against the current exact release.
3. Re-check that the checkout is clean and HEAD/runtime image revision have not changed during the verification window.
4. Record only the previous SHA and immutable image tag needed for rollback; never print environment values.

`topology-preflight` is a prerequisite deliverable and remains read-only. It validates canonical Compose ownership and detects conflicting unmanaged/mislabelled `boardreadyops-cloud-*` containers without repairing them.

## Rollout

The deployer checks out the admitted candidate as a detached exact SHA. Detached production checkouts avoid rewriting a local deployment branch during rollback and make the runtime identity explicit.

The existing operator Compose wrapper derives `BOARDREADYOPS_IMAGE_TAG` and OCI revision labels from checkout HEAD. The deploy sequence is:

1. Build the candidate runtime image through the `migrate` service definition. Web and worker reference the same immutable SHA tag.
2. Run the migration service and require successful completion. Migrations remain forward-compatible and are never reversed automatically.
3. Start a temporary one-off `web` canary through `docker compose run --detach --no-deps`, publishing only `127.0.0.1:3004:3000` and using a SHA-derived bounded container name.
4. Poll the canary readiness endpoint and require `{ "ok": true }` before touching live web/worker containers.
5. Remove the canary.
6. Recreate `web` and `worker` with the candidate immutable image using the existing Compose project and without rebuilding.
7. Poll `boardreadyops-maintenance runtime-status` until it reports the candidate SHA, healthy web/worker/PostgreSQL/Redis, and `ready=true`.
8. Probe the configured public HTTPS health URL and require `{ "ok": true }`.

Caddy, PostgreSQL, Redis, and tunnel services are not recreated by an ordinary web/worker rollout.

## Failure and rollback

If build, migration, canary, live recreation, runtime verification, or public health verification fails, the deployer:

1. Removes any canary best-effort.
2. Checks out the previous exact SHA as detached HEAD.
3. Recreates only `web` and `worker` from the previous immutable image with `--no-build --no-deps`.
4. Requires runtime status and public health to return to the previous SHA.
5. Emits a bounded rollback result.

If rollback verification fails, the service exits failed and emits `manual_intervention_required`; it does not loop destructive repair actions. Database schema stays at the forward version.

## Production normalization before enabling automation

The timer must not be enabled while checkout/image drift exists. Initial commissioning is therefore explicit:

1. Install and verify `topology-preflight` first.
2. With live containers unchanged, move the production checkout to the exact currently running image SHA as detached HEAD so `runtime-status` becomes internally consistent.
3. Run topology preflight and backup/restore verification against that exact current release.
4. Install the deployer but leave the timer disabled.
5. Run the deployer once in dry-run/admission-only mode against current `main` and inspect bounded output.
6. Run one supervised real rollout to current `main` and verify runtime/public health.
7. Enable the timer only after the supervised rollout succeeds.

## Security boundaries

- No inbound listener is added.
- No GitHub token, SSH private key, database URL, Doppler token, GitHub App private key, or runtime environment value is emitted by the deployer.
- GitHub API responses are parsed in memory; raw response bodies are not logged.
- The deployer accepts no arbitrary shell command, branch, repository URL, image tag, Compose file, or environment override from GitHub.
- The deployment directory and repository identity come from root-owned local configuration.
- The deployer requires the repository remote and candidate ancestry to match the configured repository.
- The maintenance service remains read-only and keeps its current Unix-only network restriction.
- The deployer service gets only the filesystem/network access required for Git fetch/API checks and the existing local deployment wrapper; it does not expose a socket or HTTP endpoint.

## Observability

Each run emits one bounded JSON event with candidate/current SHA prefixes, phase, and result category. Allowed categories include `up_to_date`, `waiting_for_ci`, `candidate_rejected`, `preflight_failed`, `backup_verification_failed`, `deployed`, `rolled_back`, and `manual_intervention_required`.

Do not emit workflow payloads, GitHub API response bodies, environment values, tenant/repository customer data, findings, artifacts, or database details.

## Testing

- Unit-test GitHub admission parsing with synthetic API responses: success, missing run, pending, failure, cancelled, malformed payload, rate limit, and verification false.
- Unit-test candidate ancestry and exact repository/branch invariants through command abstraction/fakes; no tests may contact production.
- Contract-test systemd unit/timer hardening and installer permissions.
- Contract-test deployment command construction, including canary locality, immutable SHA tags, rollback without migration reversal, and no arbitrary arguments.
- Extend production maintenance tests for `topology-preflight`, including a static no-mutation/no-secret-read assertion.
- Run shell/Python syntax checks, focused Vitest suites, workflow security lint, typecheck/build where affected, and the repository's full `verify:all` before PR readiness.
- Production commissioning is separate evidence after merge; local tests must never mutate production.

## Delivery sequence

1. Complete the already-planned `topology-preflight` prerequisite as a focused change.
2. Add the host-local deployer, installer, timer, tests, and operator documentation as a second focused change after the prerequisite is available.
3. After both are merged and all required GitHub checks pass, install the updated maintenance boundary, normalize the current checkout to the running image revision without changing containers, run supervised commissioning, then enable the timer.
4. Keep the existing manual deployment path available as break-glass recovery; automation must never remove it.
