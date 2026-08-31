# Manual Cloud Deploy Action — Design Specification

Status: Approved design direction
Date: 2026-08-31
Scope: One new GitHub Actions workflow that lets an operator trigger the existing self-hosted production deploy runbook remotely, over Tailscale, with secrets sourced from Doppler. Does not change the deploy mechanism itself (`scripts/deploy-cloud.mjs`, `pnpm run cloud:deploy:self-hosted`).

## 1. Product intent

Today, deploying BoardReadyOps Cloud to the self-hosted production host means an operator opens a terminal, SSHes in over Tailscale, and manually runs the runbook in [Self-hosted deployment](../../deployment/self-hosted.md#repeatable-self-hosted-deploy-from-main). This adds a button in the GitHub Actions UI that runs the exact same runbook remotely, so an operator doesn't need a terminal open on a machine that has Tailscale + SSH access configured — while remaining a manual, privileged, one-operator-click action, not an automatic side effect of merging code.

This intentionally does not change the project's existing deployment security posture: the production host's `exec-agent` maintenance service still gets no Docker access and no generic command execution ([`deploy/maintenance/server.py`](../../../deploy/maintenance/server.py)); this workflow uses a separate, dedicated SSH identity with the same privilege a human operator already has when deploying, not an elevation of it.

## 2. Non-goals

- No automatic deploy on push/merge to `main`. The workflow trigger is `workflow_dispatch` only.
- No self-hosted GitHub Actions runner installed on the production host — that would leave a persistent CI credential sitting in production.
- No change to `scripts/deploy-cloud.mjs`, the Compose topology, or the canary/health-check/rollback logic already documented — this workflow is a remote invoker of the existing runbook, not a new deploy engine.
- No public SSH exposure. The host stays reachable only over Tailscale.
- No use of Vercel or any other hosted platform (superseded — see updated [ADR-0008](../../architecture/adr/0008-vercel-control-plane.md) and [ROADMAP.md](../../ROADMAP.md) item 16).

## 3. Trigger and safety gate

- Trigger: `workflow_dispatch` only, with one input, `dry_run` (boolean, default `true`). Defaulting to `true` means a click of the button without changing the input rehearses the deploy (build, migrate-check, canary, health-check) without touching the live `bro-web`/`bro-worker` containers — mirroring `BOARDREADYOPS_CLOUD_DRY_RUN=1` support already in `scripts/deploy-cloud.mjs`. An operator must deliberately flip it to `false` to perform a real deploy.
- The job declares `environment: production`, which gives the run a visible entry in the repository's Environments/deployments audit trail. No required reviewers are configured in this iteration (the manual-dispatch button is the approval gate), but the environment is in place so a required-reviewer rule can be added later without a workflow rewrite.
- `concurrency: { group: cloud-deploy, cancel-in-progress: false }` so two deploys can never run against the host at once; a second dispatch queues behind the first instead of racing it.

## 4. Secrets model

Exactly one GitHub Actions secret is needed: `DOPPLER_TOKEN`, a Doppler **service token** scoped to project `boardreadyops`, config **`deploy`** (a new config, separate from the existing `main`/`runtime` configs used by the application itself). Scoping it to a dedicated config means this workflow's token can never read application runtime secrets (database URL, session secret, GitHub App keys, etc.) — its blast radius is limited to what deployment needs.

The `deploy` Doppler config holds:

| Secret | Purpose |
|---|---|
| `CLOUD_DEPLOY_SSH_PRIVATE_KEY` | Private half of a dedicated SSH keypair, authorized only for the `ubuntu` account on the production host, used only by this workflow (not an operator's personal key). |
| `CLOUD_DEPLOY_SSH_HOST` | The host's Tailscale MagicDNS name or Tailscale IP (e.g. `100.92.234.31`). |
| `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` | OAuth client credentials for the `tailscale/github-action`, scoped (via Tailscale ACL tag, e.g. `tag:ci-deploy`) to only reach the production host on port 22. |

The job runs `doppler run --project boardreadyops --config deploy -- <step>` (or downloads secrets into the step's environment) so none of these values are ever written to workflow YAML, GitHub secrets, or logs directly — Doppler is the single source of truth for them, matching how the project already treats Doppler as its approved secret-management system (see `docs/development/release-assurance.md`).

## 5. Workflow steps

1. **Join Tailscale.** `tailscale/github-action`, pinned to a reviewed commit SHA, authenticated with the OAuth client from Doppler, requesting an **ephemeral, tagged** node (`tag:ci-deploy`). The node is torn down automatically when the job ends — no persistent tailnet presence survives the run.
2. **Load the SSH key.** Pull `CLOUD_DEPLOY_SSH_PRIVATE_KEY` from Doppler, write it to a `mktemp` file with `chmod 600`, load it with `ssh-agent`. The temp file is removed in a final `if: always()` cleanup step.
3. **Run the runbook over SSH.** One `ssh` call to `ubuntu@${{ env.CLOUD_DEPLOY_SSH_HOST }}` executing, verbatim, the sequence already documented in `self-hosted.md`:
   ```bash
   set -euo pipefail
   cd /opt/repos/boardreadyops-prod
   git fetch origin --prune
   git checkout prod-main
   git merge --ff-only origin/main
   BOARDREADYOPS_CLOUD_DRY_RUN=<0-or-1> pnpm run cloud:deploy:self-hosted
   ```
   The `dry_run` workflow input is passed as an `env:` value (never interpolated as a raw string into the `run:` block) and mapped to `0`/`1` before being forwarded, so untrusted-input injection into the remote shell isn't possible.
4. **Surface the result.** The SSH command's exit code is the step's exit code; a failed deploy fails the job (red run in the Actions UI is the operator's signal — `scripts/deploy-cloud.mjs` already restores the previous containers automatically on failure per its documented rollback behavior).
5. **Cleanup (`if: always()`).** Remove the temp SSH key file and kill the `ssh-agent` process. The Tailscale action's own post-step handles tearing down the ephemeral node.

## 6. Files touched

- Create: `.github/workflows/cloud-deploy.yml`.
- Modify: `docs/deployment/self-hosted.md` — add a short section documenting the workflow_dispatch trigger as an alternative to the manual SSH runbook, cross-referencing this spec; the manual runbook stays as the documented fallback/reference procedure.

## 7. Testing / acceptance

1. `actionlint` (already run in `.github/workflows/lint-fast.yml` and as a `.pre-commit-config.yaml` hook) passes on the new workflow file.
2. `zizmor` (already a pre-commit hook, min severity medium) passes — all actions pinned to a commit SHA, no untrusted-input string interpolation into `run:` blocks, least-privilege `permissions:` block (this workflow needs no `GITHUB_TOKEN` write scope; set `permissions: {}` or `contents: read` only).
3. A manual dispatch with `dry_run: true` completes successfully end-to-end (Tailscale join, SSH, canary build + health check, canary teardown) without touching the live containers — confirms connectivity and the Doppler secret wiring before anyone runs a real deploy through it.
4. A manual dispatch with `dry_run: false` is exercised once, deliberately, to confirm the real path matches the documented manual runbook's outcome (new image live, old container retained as rollback, health endpoint green).
5. Confirm the job's Tailscale node is ephemeral and no longer appears in the tailnet device list after the run completes.
