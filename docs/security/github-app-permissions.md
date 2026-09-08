# GitHub App Capabilities, Permissions & Security Boundary

This document is the authoritative product capability and security model for the BoardReadyOps GitHub App. It supersedes early exploratory and restrictive permission notes (including historical issue #88) with an explicit, capability-driven security architecture for a zero-touch, GitHub-native hardware release platform.

---

## 1. Architectural Philosophy: Capabilities Over Minimal Stagnation

BoardReadyOps' core product goal is:
> **"Install once → open a pull request → BoardReadyOps does the rest."**

Hardware engineers, PCB designers, and firmware reviewers should never be forced to:
- clone repositories locally just to run linting or DRC,
- open a terminal or install CLI binaries,
- manually copy/paste YAML boilerplate into `.github/workflows/`,
- manually construct `boardreadyops.yml`,
- leave GitHub for routine reviews, approvals, or waivers.

To provide this zero-touch developer experience natively inside GitHub, the BoardReadyOps GitHub App requests permissions that map directly to transparent product capabilities. If an organization restricts any optional permission, the platform **degrades gracefully**, clearly explaining what capability is disabled and providing the self-service alternative.

---

## 2. Product Capability to Permission Matrix

| Capability | Purpose & Benefit | GitHub Permissions | Webhooks Required | Runtime Boundary & Safety Controls | Audit & Traceability |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Identity & Discovery** | Correlate repository, org account, and installation lifecycle | `metadata: read` | `installation`, `installation_repositories` | Read-only. No source code or confidential design access. | Installation events recorded with delivery ID in audit ledger. |
| **Native Check Runs & Annotations** | Render check runs, inline PCB/BOM annotations on Files Changed tab, and interactive action buttons | `checks: write` | `check_run` (`rerequested`, `requested_action`) | Bounded to 500 annotations; line-clamped (1–65535); CAD binary files excluded. Actions limited to 3 buttons. | External run ID bound to GitHub Check Run external_id. |
| **Workflow Dispatch** | Trigger `.github/workflows/readiness-runner.yml` on PR events | `actions: write` | `workflow_run` (`completed`, `in_progress`) | Triggers only the exact repository workflow with exact PR commit SHA and run-attempt binding. | Dispatches logged with trigger reason and commit SHA. |
| **PR Summaries & Discussions** | Post and update progressive disclosure PR summary comment; reply to PR slash commands | `pull_requests: write`<br>`issues: write` | `issue_comment` (`created`), `pull_request` (`opened`, `synchronize`, `reopened`), `pull_request_review` (`submitted`) | Upserts single stable marker comment `<!-- boardreadyops:release-readiness -->`. Never posts duplicate spam. Sanitizes all markdown. | Comment upsert tracked in publication audit state. |
| **One-Click Setup & Remediation PRs** | Open automated PRs containing `boardreadyops.yml` and runner workflow without requiring local git commands | `contents: write`<br>`workflows: write` | N/A (invoked via webhook action or web UI) | **Strict Allowlist:** Only `boardreadyops.yml`, `.github/workflows/readiness-runner.yml`, and `.boardreadyops/*`. **Never writes directly to default branch (`main`)**; always branches off exact base SHA. Respects branch protection rules. | Git Data API commits with signed message, branch, and tree SHA recorded in audit log. |

---

## 3. Strict Mutation Service Boundaries

All repository mutations performed by BoardReadyOps are governed by the `GitHubMutationService` in `@boardreadyops/cloud-core`:

1. **Default Branch Immunity**:
   - BoardReadyOps **never** writes directly to the default branch (`main`, `master`, etc.).
   - Every mutation is committed to an isolated ephemeral branch (e.g. `boardreadyops/setup`, `boardreadyops/waiver-<ruleId>`).
   - A standard GitHub Pull Request is opened for human maintainer review and approval.

2. **File Path Allowlist**:
   - Only files strictly within the configuration allowlist can be created or updated:
     - `boardreadyops.yml`
     - `.github/workflows/readiness-runner.yml`
     - `.boardreadyops/**`
   - Path traversal attempts (`..`), absolute paths, null bytes (`\0`), control characters, and hidden path tricks are rejected with validation errors.

3. **Base Commit SHA Binding**:
   - Mutations query the default branch head commit SHA and create the branch ref directly at that exact commit.
   - If the remote ref has drifted or changed concurrently, mutations fail fast rather than creating divergent histories.

4. **Idempotency**:
   - Trees are compared before creating commits. If the target repository already contains identical file contents, no empty commit or duplicate PR is created; the service returns `{ status: "already_exists" }`.

5. **Ruleset & Protection Respect**:
   - BoardReadyOps never attempts to bypass branch protections, code owner reviews, or repository rulesets.
   - It **never** automatically applies restricted labels like `queue-me` or auto-merges without human approval.

---

## 4. Graceful Degradation Model

If an enterprise customer or repository administrator installs the GitHub App with a restricted permission subset, BoardReadyOps adapts without crashing:

| Missing Permission | Impact on Experience | Graceful Degradation Path |
| :--- | :--- | :--- |
| `contents: write` or `workflows: write` | Automated one-click PRs unavailable | Setup page displays copy-ready YAML and files; Check Run displays setup instructions instead of action buttons. |
| `actions: write` | Automatic workflow dispatch unavailable | Customer can run external/self-hosted runner or manually trigger workflow in GitHub Actions tab. |
| `pull_requests: write` or `issues: write` | PR summary comment cannot be upserted | Check Run remains 100% functional and authoritative; deep link to web dashboard provided. |
| `checks: write` | Native Check Runs and inline annotations unavailable | Results posted exclusively as PR summary comments or viewed in web dashboard. |

---

## 5. Threat Model & Security Controls

1. **Token Lifetime**:
   - Installation access tokens are ephemeral (1 hour expiration) and created on-demand for specific repository IDs.

2. **Safe Mode Enforcement**:
   - Pull requests from public forks, draft PRs, or untrusted external actors trigger **Safe Mode**:
     - Workflow dispatch is restricted or prevented from accessing secrets.
     - Dangerous mutations cannot be triggered by unprivileged actors.
     - Comments and Check Runs clearly indicate "Trust Mode: Safe (restricted)".

3. **Injection Prevention**:
   - Rule IDs, file paths, and waiver reasons are strictly validated against regex patterns (`^[a-zA-Z0-9_.-]+$`).
   - Markdown output escapes pipe characters (`|`), angle brackets, and backticks to prevent prompt/markdown injection attacks.

4. **Privacy-Safe Telemetry**:
   - TTFUF telemetry tracks product activation without transmitting net names, schematic text, component values, or customer IP.
