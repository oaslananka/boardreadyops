# Manual Cloud Deploy Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `workflow_dispatch`-only GitHub Actions workflow that lets an operator remotely run the existing self-hosted production deploy runbook (`pnpm run cloud:deploy:self-hosted`) over Tailscale via SSH, with all secrets sourced from a dedicated Doppler config — without changing the deploy mechanism itself or granting any new standing production access.

**Architecture:** One job on a GitHub-hosted runner: install the Doppler CLI, pull deploy-only secrets from a new Doppler `deploy` config into masked env vars and a temp SSH key file, join the tailnet as an ephemeral tagged node via the official Tailscale action, then run the exact documented manual runbook over one SSH call. No checkout step is needed — the deploy runs entirely on the remote host, which pulls its own code from `origin/main`.

**Tech Stack:** GitHub Actions (YAML), Doppler CLI, Tailscale (`tailscale/github-action`), OpenSSH client (preinstalled on `ubuntu-24.04` runners).

**Spec:** [docs/superpowers/specs/2026-08-31-cloud-deploy-action-design.md](../specs/2026-08-31-cloud-deploy-action-design.md)

## Global Constraints

- Trigger is `workflow_dispatch` only — no automatic deploy on push/merge to `main`.
- No self-hosted runner on the production host.
- No change to `scripts/deploy-cloud.mjs`, Compose topology, or the canary/health-check/rollback logic.
- No public SSH exposure — the host is reached only over Tailscale.
- Exactly one GitHub Actions secret: `DOPPLER_TOKEN`, scoped to Doppler project `boardreadyops`, config `deploy`.
- All GitHub Actions `uses:` references pinned to a full commit SHA (repo convention; see `.github/workflows/publish-npm.yml`).
- `permissions: contents: read` at the workflow level (no `GITHUB_TOKEN` write scope is needed by this job).
- Job declares `environment: production` for audit-trail visibility.

---

### Task 1: Create the cloud-deploy workflow

**Files:**
- Create: `.github/workflows/cloud-deploy.yml`

**Interfaces:**
- Consumes: repository secret `DOPPLER_TOKEN`; Doppler `deploy` config keys `CLOUD_DEPLOY_SSH_PRIVATE_KEY`, `CLOUD_DEPLOY_SSH_HOST`, `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET` (provisioned manually in Doppler and Tailscale by the operator — Task 3 documents exactly what to create; this task assumes those keys exist under those exact names once the workflow is exercised).
- Produces: a `workflow_dispatch`-triggered job named `deploy` in workflow `cloud-deploy`, with one input `dry_run` (boolean, default `true`).

- [ ] **Step 1: Write the workflow file**

Create `.github/workflows/cloud-deploy.yml`:

```yaml
name: cloud-deploy

on:
  workflow_dispatch:
    inputs:
      dry_run:
        description: Rehearse the deploy (build, migrate-check, canary, health-check) without touching the live containers.
        required: false
        default: true
        type: boolean

concurrency:
  group: cloud-deploy
  cancel-in-progress: false

permissions:
  contents: read

jobs:
  deploy:
    runs-on: ubuntu-24.04
    timeout-minutes: 30
    environment: production
    steps:
      - name: Install Doppler CLI
        uses: dopplerhq/cli-action@4819d808ab99e5cde19a0637a16536a4038fad73 # v4.0.1

      - name: Load deploy secrets from Doppler
        env:
          DOPPLER_TOKEN: ${{ secrets.DOPPLER_TOKEN }}
        run: |
          set -euo pipefail

          key_path="${RUNNER_TEMP}/cloud-deploy-key"
          doppler secrets get CLOUD_DEPLOY_SSH_PRIVATE_KEY --plain \
            --project boardreadyops --config deploy > "${key_path}"
          chmod 600 "${key_path}"
          echo "CLOUD_DEPLOY_SSH_KEY_PATH=${key_path}" >> "$GITHUB_ENV"

          ssh_host="$(doppler secrets get CLOUD_DEPLOY_SSH_HOST --plain \
            --project boardreadyops --config deploy)"
          echo "::add-mask::${ssh_host}"
          echo "CLOUD_DEPLOY_SSH_HOST=${ssh_host}" >> "$GITHUB_ENV"

          ts_client_id="$(doppler secrets get TAILSCALE_OAUTH_CLIENT_ID --plain \
            --project boardreadyops --config deploy)"
          echo "::add-mask::${ts_client_id}"
          echo "TAILSCALE_OAUTH_CLIENT_ID=${ts_client_id}" >> "$GITHUB_ENV"

          ts_client_secret="$(doppler secrets get TAILSCALE_OAUTH_CLIENT_SECRET --plain \
            --project boardreadyops --config deploy)"
          echo "::add-mask::${ts_client_secret}"
          echo "TAILSCALE_OAUTH_CLIENT_SECRET=${ts_client_secret}" >> "$GITHUB_ENV"

      - name: Connect Tailscale
        uses: tailscale/github-action@780049a30b6ff5c378a9e7b389d15ece7a204888 # v4.1.3
        with:
          oauth-client-id: ${{ env.TAILSCALE_OAUTH_CLIENT_ID }}
          oauth-secret: ${{ env.TAILSCALE_OAUTH_CLIENT_SECRET }}
          tags: tag:ci-deploy
          version: 1.94.2
          ping: ${{ env.CLOUD_DEPLOY_SSH_HOST }}

      - name: Run production deploy runbook
        env:
          DRY_RUN_FLAG: ${{ inputs.dry_run && '1' || '0' }}
        run: |
          set -euo pipefail
          ssh -i "${CLOUD_DEPLOY_SSH_KEY_PATH}" \
            -o StrictHostKeyChecking=accept-new \
            -o ConnectTimeout=15 \
            "ubuntu@${CLOUD_DEPLOY_SSH_HOST}" \
            "set -euo pipefail; cd /opt/repos/boardreadyops-prod && git fetch origin --prune && git checkout prod-main && git merge --ff-only origin/main && BOARDREADYOPS_CLOUD_DRY_RUN=${DRY_RUN_FLAG} pnpm run cloud:deploy:self-hosted"

      - name: Remove temporary SSH key
        if: always()
        run: rm -f "${CLOUD_DEPLOY_SSH_KEY_PATH}"
```

Notes on choices an implementer should not second-guess:

- No `actions/checkout` step: the deploy runs entirely over SSH on the remote host, which does its own `git fetch`/`checkout`/`merge` against `origin/main`. The runner never needs the repository locally.
- `dry_run` is a typed `boolean` input, and `DRY_RUN_FLAG` is computed via a ternary in the `env:` mapping (`'1'`/`'0'` only) rather than interpolated as a raw string into the `run:` block — this is what keeps the remote shell command free of attacker-controlled string injection.
- The SSH private key is written straight from `doppler secrets get ... > "${key_path}"` — it is never captured into a shell variable or echoed, so it can never appear in step output even by accident. The Tailscale OAuth values and the host, which are single-line, are captured into variables so they can be explicitly masked with `::add-mask::` before being written to `$GITHUB_ENV`.
- `tailscale/github-action`'s built-in `ping:` input verifies reachability to the host as part of connecting, so no separate connectivity-check step is needed.
- Cleanup only needs to remove the temp key file; the Tailscale action registers its own `post:` step that logs out and tears down the ephemeral node automatically.

- [ ] **Step 2: Validate the YAML parses**

```bash
node -e "const yaml=require('js-yaml');const fs=require('fs');yaml.load(fs.readFileSync('.github/workflows/cloud-deploy.yml','utf8'));console.log('valid yaml')"
```

Expected: prints `valid yaml` with no error. (`js-yaml` is already a repo devDependency, so this needs no new install.)

- [ ] **Step 3: Run actionlint and zizmor against the new workflow**

```bash
uvx --from pre-commit==4.6.0 pre-commit run actionlint --files .github/workflows/cloud-deploy.yml
uvx --from pre-commit==4.6.0 pre-commit run zizmor --files .github/workflows/cloud-deploy.yml
```

Expected: both exit 0. (This is the exact tool invocation `.github/workflows/ci.yml` runs in CI, via `uvx` — it does not depend on the repository's own Node/Corepack toolchain, so it works even in an environment where `corepack pnpm run toolchain:bootstrap` cannot run.) If either flags something, fix the workflow file and re-run rather than suppressing the finding.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/cloud-deploy.yml
git commit -m "feat(ci): add manual cloud-deploy workflow over Tailscale + Doppler"
```

---

### Task 2: Document the new trigger in the deployment runbook

**Files:**
- Modify: `docs/deployment/self-hosted.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a new subsection immediately after the existing "Repeatable self-hosted deploy from main" section, so the manual SSH runbook and the new remote-trigger option sit next to each other.

- [ ] **Step 1: Insert the new subsection**

In `docs/deployment/self-hosted.md`, immediately after the numbered list ending in "Removes previous containers after success while retaining the rollback image." and the "immutable Docker image tied to one Git revision" paragraph (i.e., right before the `## Independent worker scaling` heading), insert:

```markdown
## Remote deploy trigger

The same runbook above can be run remotely from the GitHub Actions UI instead of an operator's terminal, via the [`cloud-deploy` workflow](../../.github/workflows/cloud-deploy.yml). It is `workflow_dispatch`-only — merging to `main` never triggers it — and it runs the identical `git fetch`/`checkout`/`merge`/`pnpm run cloud:deploy:self-hosted` sequence over SSH, reached over Tailscale rather than the public internet.

One-time setup before the workflow can be used:

1. In Tailscale, create an OAuth client scoped to a dedicated tag (e.g. `tag:ci-deploy`) that can reach only the production host on port 22, and configure that tag's nodes as ephemeral so a run leaves no persistent tailnet device behind.
2. In Doppler, create a new config named `deploy` under the `boardreadyops` project (separate from `main`/`runtime`, so this workflow's token can never read application runtime secrets) containing:
   - `CLOUD_DEPLOY_SSH_PRIVATE_KEY` — the private half of a dedicated SSH keypair, authorized only for the `ubuntu` account on the production host and used only by this workflow (not an operator's personal key).
   - `CLOUD_DEPLOY_SSH_HOST` — the host's Tailscale IP or MagicDNS name.
   - `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET` — the OAuth client from step 1.
3. Create a Doppler service token scoped to project `boardreadyops`, config `deploy`, and store it as the single GitHub Actions repository secret `DOPPLER_TOKEN`.
4. Create a `production` GitHub Environment (Settings → Environments) so the workflow's `environment: production` reference resolves and the run appears in the deployments audit trail.

To use it: open the Actions tab, select **cloud-deploy**, click **Run workflow**. Leave `dry_run` at its default `true` to rehearse the canary and health checks without touching the live containers; set it to `false` to perform a real deploy. A failed run leaves the live containers untouched — `scripts/deploy-cloud.mjs` restores the previous containers automatically on failure, exactly as it does when the runbook is run manually.
```

- [ ] **Step 2: Confirm the relative links resolve**

```bash
grep -n "cloud-deploy.yml\|deploy/self-hosted.md" docs/deployment/self-hosted.md
```

Expected: the new `../../.github/workflows/cloud-deploy.yml` link line appears; visually confirm the relative path is correct from `docs/deployment/self-hosted.md` (two levels up to repo root, then into `.github/workflows/`).

- [ ] **Step 3: Commit**

```bash
git add docs/deployment/self-hosted.md
git commit -m "docs(deployment): document the cloud-deploy remote trigger and its setup"
```

---

### Task 3: Manual one-time provisioning (operator, not code)

This task has no files to change — it is the operator setup that Task 2's documentation describes, required before the workflow can succeed. Record it as a task so it isn't silently skipped.

- [ ] **Step 1:** In the Tailscale admin console, create an OAuth client with the `auth_keys` scope, tagged `tag:ci-deploy`, and set that tag's devices to ephemeral in the tailnet's ACL policy.
- [ ] **Step 2:** Generate a dedicated SSH keypair (not an operator's personal key) and add its public half to `~ubuntu/.ssh/authorized_keys` on the production host.
- [ ] **Step 3:** In Doppler, create the `deploy` config under project `boardreadyops` and populate `CLOUD_DEPLOY_SSH_PRIVATE_KEY`, `CLOUD_DEPLOY_SSH_HOST`, `TAILSCALE_OAUTH_CLIENT_ID`, `TAILSCALE_OAUTH_CLIENT_SECRET` from steps 1–2.
- [ ] **Step 4:** Create a Doppler service token scoped to `boardreadyops`/`deploy` and add it as the GitHub Actions repository secret `DOPPLER_TOKEN`.
- [ ] **Step 5:** Create the `production` GitHub Environment in repository settings.
- [ ] **Step 6:** Dispatch `cloud-deploy` once with `dry_run: true` and confirm the run succeeds end-to-end (Tailscale connects, `ping` succeeds, canary builds and passes health check, canary is torn down) before ever running it with `dry_run: false`.

---

### Task 4: Verify nothing else references the superseded Vercel plan

**Files:** none (verification only) — the actual Vercel-cleanup edits (ADR-0008 status, ROADMAP.md item 16) already landed in commit `cae5d0f` on this branch, ahead of this plan.

- [ ] **Step 1: Confirm no other doc still frames Vercel as the current plan**

```bash
git grep -in "vercel" -- '*.md' ':!docs/architecture/adr/0008-vercel-control-plane.md'
```

Expected output: only the already-reviewed, non-forward-looking mentions — `docs/architecture/cloud-data-model.md` (a "Related" link to the now-Superseded ADR, still valid as a historical link), and `docs/deployment/self-hosted.md`'s existing "do not infer a Vercel Blob... guarantee" caveat (accurate as-is, reinforces that Vercel Blob is not used). If anything else appears describing Vercel as an active plan, fix it in this task.

- [ ] **Step 2: No commit needed if Step 1 finds nothing new to fix.**
