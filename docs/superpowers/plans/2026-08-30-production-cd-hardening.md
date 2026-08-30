# Production CD Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a fail-closed, pull-based production deployer that rolls an admitted `main` SHA to the BoardReadyOps Compose production stack without inbound deployment credentials.

**Architecture:** Keep the existing public `cloud:deploy:self-hosted` path unchanged. BoardReadyOps-operated production gets a separate root-owned systemd oneshot/timer that resolves `origin/main`, requires GitHub verification plus exact-SHA `ci` and `security` success, uses the existing local Compose wrapper, proves a local canary, and rolls web/worker back to the previous immutable image on failure. The read-only maintenance boundary supplies runtime, topology, and backup/restore gates but never gains deployment authority.

**Tech Stack:** Python 3 stdlib, Bash, systemd, Git, Docker Compose, Vitest contract tests.

**Spec:** `docs/superpowers/specs/2026-08-30-production-cd-hardening-design.md`

## Global Constraints

- Complete `docs/superpowers/plans/2026-08-23-production-topology-preflight.md` first.
- No inbound deployment listener or production-host Actions runner is added.
- Candidate branch is fixed to `main`; arbitrary branch/SHA input is not accepted.
- Candidate must be a fast-forward descendant of the currently deployed exact SHA.
- Candidate GitHub commit verification must be true.
- Newest exact-SHA `push` runs of `ci.yml` and `security.yml` must both be completed/successful.
- Current runtime, topology preflight, and backup/restore verification must pass before production mutation.
- Database migrations may advance but are never automatically reversed.
- Public `cloud:deploy:self-hosted` behavior remains backward-compatible.
- Logs are aggregate/bounded and never include secrets, database URLs, API bodies, findings, artifact paths, or tenant data.

## File structure

- `deploy/deployer/production-deployer.py` — fixed admission, rollout, health verification, and rollback orchestration.
- `deploy/deployer/boardreadyops-deployer.service` — hardened root oneshot with outbound networking and deployment-dir write scope.
- `deploy/deployer/boardreadyops-deployer.timer` — five-minute pull cadence with jitter and no overlap.
- `deploy/deployer/install.sh` — root installer; validates local deployment wrapper and installs config/service/timer without enabling the timer.
- `tests/unit/scripts/production-deployer.test.ts` — Python behavior plus static security/systemd/installer contracts.
- `tests/unit/docs/control-plane-operations-docs.test.ts` — production-CD documentation contract.
- `docs/deployment/self-hosted.md` — operator commissioning, rollback, and break-glass contract.

### Task 1: Finish the read-only topology prerequisite

**Files:** use the exact files and tests in `docs/superpowers/plans/2026-08-23-production-topology-preflight.md`.

**Interfaces:**
- Consumes: maintenance request `{ "version": 1, "operation": "topology-preflight" }`.
- Produces: `boardreadyops-maintenance topology-preflight`, exit 0 only when canonical Compose ownership is safe.

- [ ] **Step 1:** Execute the existing topology-preflight plan with witnessed RED/GREEN tests.
- [ ] **Step 2:** Run `bash -n deploy/maintenance/topology-preflight.sh` and the maintenance/docs focused Vitest suites.
- [ ] **Step 3:** Commit only the prerequisite implementation/docs before deployer code.

### Task 2: Define production candidate admission with TDD

**Files:**
- Create: `deploy/deployer/production-deployer.py`
- Create: `tests/unit/scripts/production-deployer.test.ts`

**Interfaces:**
- `validate_repository(value: str) -> str`
- `candidate_admission(repository: str, candidate: str, http_get_json) -> tuple[bool, str]`
- `latest_workflow_success(document: dict, candidate: str) -> bool`

- [ ] **Step 1: Write the failing admission contract test.** Import the Python module through `importlib.util`; verify repository validation, exact 40-hex candidate handling, commit verification, and newest exact-SHA workflow status for success/missing/pending/failure/cancelled/malformed cases.
- [ ] **Step 2: Run `corepack pnpm exec vitest run tests/unit/scripts/production-deployer.test.ts`.** Expected: RED because the module does not exist.
- [ ] **Step 3: Implement minimal admission logic.** Use only Python stdlib HTTP/JSON helpers. Build GitHub URLs from validated `owner/repo` and candidate SHA. Set fixed API headers and never log response bodies.
- [ ] **Step 4: Require the commit endpoint to report `commit.verification.verified=true`.**
- [ ] **Step 5: Require the newest exact-SHA `push` run from both `ci.yml` and `security.yml` to be `completed`/`success`.** Missing, malformed, unavailable, failed, or cancelled evidence returns a bounded rejection category.
- [ ] **Step 6: Re-run the focused test.** Expected: GREEN.
- [ ] **Step 7: Commit with `feat(cloud): gate production revisions on exact CI`.**

The workflow endpoint is fixed to:

```text
https://api.github.com/repos/<owner>/<repo>/actions/workflows/<workflow>/runs?branch=main&event=push&head_sha=<sha>&per_page=5
```

### Task 3: Add fixed rollout and rollback orchestration with TDD

**Files:**
- Modify: `deploy/deployer/production-deployer.py`
- Modify: `tests/unit/scripts/production-deployer.test.ts`

**Interfaces:**
- `deploy_commands(deployment_dir: str, candidate: str) -> list[list[str]]`
- `rollback_commands(deployment_dir: str, previous: str, live_replaced: bool) -> list[list[str]]`
- fixed local wrapper: `<deployment-dir>/deploy.sh`
- fixed canary publish: `127.0.0.1:3004:3000`

- [ ] **Step 1: Write failing command-contract tests.** Require build of `migrate`, one explicit migration run, a detached one-off `web` canary, and live `web`/`worker` recreation with `--no-build --no-deps`.
- [ ] **Step 2: Assert rollback after live replacement performs exact previous-SHA detached checkout then recreates only `web` and `worker`.** Rollback before live replacement performs only the checkout restoration.
- [ ] **Step 3: Assert command arrays contain no history rewrite, remote push, arbitrary shell, or migration execution during rollback.**
- [ ] **Step 4: Run the focused test.** Expected: RED for missing orchestration helpers.
- [ ] **Step 5: Implement fixed argv helpers with `shell=False`, explicit cwd, bounded timeouts, and no environment logging.**
- [ ] **Step 6: Implement pre-mutation gates in order:** current runtime identity, `git fetch origin main`, ancestry, candidate admission, topology preflight, backup/restore verification, then a second clean/current identity check.
- [ ] **Step 7: Check out the admitted candidate as detached HEAD and build the immutable candidate image.**
- [ ] **Step 8: Run migration once, then start the canary on localhost only and require `/api/health/ready` to return HTTP success with `{ "ok": true }` before live replacement.**
- [ ] **Step 9: Recreate only live `web` and `worker`, then require maintenance runtime status to bind both checkout and image to the candidate SHA and require the configured public HTTPS health endpoint.**
- [ ] **Step 10: On failure, remove canary best-effort, restore previous detached checkout, and recreate old web/worker only if live replacement happened.** If rollback health fails, return `manual_intervention_required` and exit non-zero.
- [ ] **Step 11: Cover dirty checkout, drift, non-fast-forward, preflight/backup failure, canary failure, successful rollback, and rollback failure.** Assert no mutating command occurs before all gates pass.
- [ ] **Step 12: Re-run focused tests and commit with `feat(cloud): add rollback-safe Compose rollout`.**

The fixed rollout command family is:

```text
<deploy.sh> build migrate
<deploy.sh> run --rm --no-deps migrate
<deploy.sh> run --detach --no-deps --name <bounded-canary> --publish 127.0.0.1:3004:3000 web
<deploy.sh> up -d --no-build --no-deps web worker
```

### Task 4: Install a hardened outbound-only systemd timer

**Files:**
- Create: `deploy/deployer/boardreadyops-deployer.service`
- Create: `deploy/deployer/boardreadyops-deployer.timer`
- Create: `deploy/deployer/install.sh`
- Modify: `tests/unit/scripts/production-deployer.test.ts`

**Interfaces:**
- installer: `install.sh --deployment-dir /absolute/path --repository owner/repo --health-url https://host/api/health`
- installed code: `/opt/boardreadyops-deployer/production-deployer.py`
- config: `/etc/boardreadyops-deployer/deployer.env`, root-owned mode `0600`
- timer is installed but intentionally not enabled by the installer.

- [ ] **Step 1: Add failing static service/timer/installer tests.** Require `Type=oneshot`, root identity, `NoNewPrivileges`, strict filesystem/kernel/device protections, outbound `AF_UNIX AF_INET AF_INET6`, runtime directory, and restrictive umask.
- [ ] **Step 2: Require timer cadence `OnBootSec=3m`, `OnUnitActiveSec=5m`, `RandomizedDelaySec=30s`, `Persistent=false`.**
- [ ] **Step 3: Require installer validation for root execution, normalized real deployment directory, `repo`, executable local deploy wrapper, HTTPS health URL, `owner/repo` syntax, maintenance client, and systemd unit verification.**
- [ ] **Step 4: Assert the installer never grants generic privilege escalation or starts/enables the timer.**
- [ ] **Step 5: Run the focused test.** Expected: RED because service/timer/installer files do not exist.
- [ ] **Step 6: Implement the units and installer.** Write only non-secret deployment path, repository, and health URL to config; create a service drop-in with `ReadWritePaths=<deployment-dir>`.
- [ ] **Step 7: Install code/assets root-owned, config directory mode `0700`, config mode `0600`; run `systemd-analyze verify` and daemon reload only.**
- [ ] **Step 8: Run shell/Python syntax checks and focused Vitest.** Expected: GREEN.
- [ ] **Step 9: Commit with `feat(cloud): install pull-based production deployer`.**

### Task 5: Document commissioning and break-glass behavior

**Files:**
- Modify: `docs/deployment/self-hosted.md`
- Modify: `tests/unit/docs/control-plane-operations-docs.test.ts`

**Interfaces:** documentation must distinguish public/self-hosted manual deployment from BoardReadyOps-operated production automation.

- [ ] **Step 1: Add failing documentation assertions** for pull-based/no-inbound behavior, exact-SHA GitHub verification plus `ci`/`security`, topology and backup gates, installer-disabled timer, initial checkout/image normalization, rollback-without-migration-reversal, and retained manual break-glass deployment.
- [ ] **Step 2: Run the docs contract test.** Expected: RED for missing production-CD contract.
- [ ] **Step 3: Document commissioning order:** install maintenance prerequisite; normalize checkout only to the currently running image SHA; verify current runtime/backup; install deployer disabled; run one admission-only check; supervise one real rollout; verify exact runtime/public health; then enable the timer.
- [ ] **Step 4: Document incident behavior:** disable the timer before manual incident work; rollback failure requires operator intervention and automation does not repeatedly mutate containers.
- [ ] **Step 5: Re-run deployer, maintenance, and docs focused tests.** Expected: GREEN.
- [ ] **Step 6: Commit with `docs(cloud): document production CD commissioning`.**

### Task 6: Full verification and PR readiness

- [ ] **Step 1:** Run `git diff --check` and inspect the complete branch diff for secrets, temp/generated files, unrelated formatting, and public-contract regressions.
- [ ] **Step 2:** Run `corepack pnpm run workflow:lint` to preserve the workflow security baseline.
- [ ] **Step 3:** Run `corepack pnpm run verify:all`; require exact exit 0 before reporting the branch ready.
- [ ] **Step 4:** Fetch `origin/main`; if it moved, integrate it using repository convention and rerun affected/full verification.
- [ ] **Step 5:** Push and open a focused PR that does not claim production commissioning.
- [ ] **Step 6:** Inspect CI, SonarCloud, Codecov, CodeQL, security bots, Mergify, and review comments. Do not bypass admission controls.
- [ ] **Step 7:** Only after merge, exact-main CI/security success, and a clean supervised commissioning window may the installed timer be enabled.
