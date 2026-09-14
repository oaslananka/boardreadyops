# ADR-0018: One Declared GitHub App Permission Profile

- **Status:** Accepted
- **Date:** 2026-09-14
- **Supersedes:** the *GitHub App permissions* section of [ADR-0009 — Managed Execution Plane](0009-managed-execution-plane.md) as a statement of the **current** profile. ADR-0009's managed-execution design, its rejection of broader permissions *as a solution to dispatch*, and its migration sequence are all retained; only its permission table is superseded, and only until the managed execution plane ships.

---

## Context

Four places in this repository described the GitHub App's permissions, and they did not agree:

| Source | Claimed profile |
| :--- | :--- |
| `apps/web/app/setup/page.tsx` — the public page a customer reads before installing | Metadata read, Pull requests **read**, Checks write, Actions write, **Contents: none** |
| `handleRepositorySetupGet` in `apps/web/lib/repository-setup-routes.ts` | Metadata read, Pull requests **write**, Checks write, Actions write, **Contents write**, Workflows write |
| `docs/operations/synthetic-target-repository-canaries.md` | Metadata read, Pull requests read, Checks r/w, Actions r/w, and an instruction to **stop commissioning** if the live App requested Contents at all |
| ADR-0009 | The future managed profile: Metadata read, Pull requests read, Checks r/w, Contents **read**, no Actions |

Meanwhile the code had already picked a side. `evaluateAppCapabilities` in `packages/cloud-core/src/github-capabilities.ts` derives `canCreateSetupPr` from `contents:write && workflows:write && pull_requests:write`; `GitHubMutationService` exists solely to make commits under those grants; `executeParsedCommand` routes `/boardreadyops setup`, `waive`, and `fix` into them. Under the profile the `/setup` page advertised, every one of those paths is dead.

The consequences were not theoretical:

- The one-click setup button had **never rendered**. `RepositorySetupInteractive` gated it on `installationId && repositoryId && canCreatePr`; its only caller passed none of the three. The product's headline promise — install once, we do the rest — had no entry point in the product.
- The endpoint behind that button, `POST /api/v1/operator/installations/:id/repositories/:id/setup/pr`, authenticates with `authenticateControlPlaneOperator`, a control-plane bearer token no browser holds. Had the props been passed, the button would have returned 401.
- `evaluateAppCapabilities` was reachable only from webhook-driven code. No page could tell a viewer which grant was missing, so graceful degradation existed in the documentation and nowhere a customer could see it.
- An operator following the canary runbook would have refused to commission an App registration that matched the product's actual requirements.

The underlying question is real and ADR-0009 answered half of it correctly: broader permissions do not solve cross-installation dispatch, and requesting them for that reason would be blast radius bought for nothing. But that is an argument about *dispatch*, and it was being applied to *mutation*, which is a different capability with a different justification.

## Decision

**One declared profile, in code, read by every surface that talks about permissions.**

`githubAppPermissionProfile` in `packages/cloud-core/src/github-capabilities.ts` declares each permission with its level, whether it is core or capability-scoped, what the product does with it, and — the part that was missing everywhere — what stops working without it. The `/setup` page, the setup API response, and the canary runbook all read from it. `tests/unit/cloud-core/github-app-permission-profile.test.ts` fails if the declaration and the capability evaluator disagree.

The profile is:

| Permission | Level | Requirement | Buys |
| :--- | :--- | :--- | :--- |
| Metadata | Read | Core | Repository identity and installation lifecycle |
| Checks | Read/write | Core | The readiness Check Run, annotations, action buttons |
| Actions | Read/write | Core | Dispatching the repository-owned readiness workflow |
| Pull requests | Read/write | Capability | Setup, waiver and remediation PRs; the summary comment |
| Contents | Read/write | Capability | Committing the allowlisted files to a review branch |
| Workflows | Read/write | Capability | Including the runner workflow in that same PR |
| Issues | Read/write | Capability | Replying to `/boardreadyops` slash commands |

No organization permission. No account permission.

### Why Contents write is justified here

The grant is bounded by the mutation service, not by trust:

1. **Path allowlist.** Only `boardreadyops.yml`, `.github/workflows/readiness-runner.yml`, and `.boardreadyops/**`. Traversal, absolute paths, null bytes, and control characters are rejected.
2. **Default-branch immunity.** Every write goes to an ephemeral branch created at an exact base SHA and is opened as a pull request. The service has no code path that writes to a default branch.
3. **No protection bypass.** Branch protection, CODEOWNERS, and rulesets stay authoritative; the App does not auto-merge and does not apply approval labels on customer repositories.
4. **Idempotency.** Identical trees produce `already_exists` rather than an empty commit or a duplicate PR.

A customer who declines the grant loses one-click setup and gets copy-ready files instead. That is a real degradation, and it is now *visible* — the setup page reads the installation's live grants and names the missing permission rather than hiding a button.

### Capability-aware surfaces

`loadInstallationCapabilities` reads the live `permissions` object returned when an installation token is minted, so the grants come back on a call the control plane already makes. Surfaces are deliberately **optimistic**: when the grants cannot be read (GitHub unreachable, key rotated), controls stay enabled and the server answers with the authoritative refusal. A control that silently vanished because of a transient outage teaches the viewer nothing.

### The dashboard action surface

`POST /api/v1/repositories/:repositoryId/actions` gives `rerun`, `release-preview`, `waive`, and `setup` a session-authenticated entry point. It is not a second implementation: `setup` reuses the same `createSetupPr`, and the rest enqueue the byte-identical lifecycle actions `executeParsedCommand` builds, through the same `acceptGitHubWebhook` intake — inheriting its idempotency, retry, dead-lettering and audit trail. Authorization is `authenticateApiRequest` + `resolveRepositoryApiContext`: a session may act only on repositories belonging to an installation its cookie recorded.

`fix` is declared but refuses with an explanation. `executeParsedCommand` never opened a remediation PR — it returned guidance text while the help table claimed otherwise — and shipping a button for it would repeat the mistake this ADR exists to correct.

## Consequences

- Adding or widening a permission means editing one array; the tests fail if the capability model disagrees, and the `/setup` table changes with it.
- Existing installations must approve the added grants. GitHub applies removals immediately and additions only on owner approval, so the narrow-profile behaviour remains correct for anyone who has not approved: they see the degradation sentence and the manual path.
- Issue #88 is closed by this ADR rather than by reducing the registration. The least-privilege concern it raised is answered by the mutation service's allowlist and branch discipline, which are enforced in code and tested, rather than by withholding a grant the product needs to do what it says it does.
- When the managed execution plane of ADR-0009 ships, `actions:write` can be dropped from the profile. That will be a removal, which takes effect without customer action.

## Alternatives considered

### Keep the narrow profile and delete the mutation service

Rejected. It would remove one-click setup, waiver PRs and remediation PRs — the difference between a linter and the product described in the README — and the code, tests and documentation for all three already exist.

### Keep both profiles and let deployments choose

Rejected. That is the state this ADR is correcting. A permission profile that varies by deployment cannot be stated truthfully on a public install page.

### Ship the broad profile without capability-aware UI

Rejected. An organisation that declines Contents is a supported configuration, not a broken one, and it must be able to see which capability that costs it and how to change its mind.
