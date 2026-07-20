# Dependency and Local Security Automation Design

**Date:** 2026-07-20  
**Status:** Approved direction  
**Scope:** Renovate reliability, local Semgrep/Snyk gates, and SonarQube Cloud developer integration

## Context

BoardReadyOps already has a strong cloud security baseline: CodeQL, OSV Scanner, Gitleaks, Dependency Review, SBOM generation, OpenSSF Scorecard, Snyk and SonarQube Cloud checks. It also contains a repository-specific `renovate.json` and documents Renovate as the single source of truth for version-update pull requests.

The remaining gaps are operational rather than conceptual:

- Renovate is installed as a GitHub App check suite but there is no current Dependency Dashboard, Renovate pull request, or `renovate/*` branch proving that onboarding and scheduling are healthy.
- Renovate references labels that do not all exist in the repository.
- Renovate configuration has no repository-owned regression test or CI validator.
- Local pre-commit checks cover formatting hygiene and Gitleaks but not repository-specific static analysis.
- Snyk and SonarQube Cloud provide cloud feedback, but developers lack a documented, deterministic local workflow.

This increment completes those boundaries without replacing or duplicating the existing cloud checks.

## Goals

1. Make Renovate configuration explicit, BoardReadyOps-specific, testable, and operationally verifiable.
2. Keep Renovate as the only routine dependency update bot while retaining GitHub vulnerability alerts/security updates.
3. Add fast, deterministic Semgrep feedback before commits.
4. Add authenticated Snyk Open Source scanning before pushes without slowing every commit.
5. Keep SonarQube Cloud as the authoritative PR quality gate and document SonarQube for IDE Connected Mode for local feedback.
6. Preserve pinned versions and least-privilege behavior across local and CI automation.

## Non-goals

- Running a full Sonar scanner on every commit.
- Replacing CodeQL, OSV, Gitleaks, Dependency Review, Snyk App, SonarQube Cloud, Socket or existing GitHub security checks.
- Enabling blind automerge for production, supply-chain, major, `0.x`, TypeScript, Node.js, pnpm, KiCad or container updates.
- Adding a second dependency updater.
- Requiring developer cloud tokens for Semgrep.
- Committing Snyk, SonarQube or Renovate credentials.

## Renovate policy

### Ownership

Renovate owns routine updates for:

- pnpm workspace dependencies and the root package manager declaration;
- GitHub Actions;
- Dockerfiles and Docker Compose images;
- repository-owned version constants discoverable through explicit custom managers.

Dependabot version-update configuration remains absent. GitHub security alerts and security update pull requests may remain enabled as emergency vulnerability controls.

### Scheduling and stability

- Time zone: `Europe/Istanbul`.
- Routine non-security updates are created during a bounded weekly maintenance window.
- Vulnerability alerts are not delayed by the routine schedule.
- A minimum release age protects normal npm updates from immediately published releases.
- Lockfile maintenance runs weekly.
- Pull request concurrency remains bounded to prevent CI saturation.

### Package groups

BoardReadyOps-specific groups are used where coordinated updates reduce compatibility risk:

- TypeScript and type tooling;
- Vitest and test tooling;
- Next.js and React runtime packages;
- Prisma and PostgreSQL tooling;
- Biome and repository quality tooling;
- OpenTelemetry/observability packages when introduced;
- GitHub Actions by functional family only when safe.

Major updates stay separate and require Dependency Dashboard approval. `0.x` dependencies are treated as potentially breaking and are not automatically merged.

### Supply-chain controls

- GitHub Actions and container references are digest-pinned.
- Action/container updates receive `supply-chain` and `manual-review` labels.
- Node.js, pnpm, TypeScript, Prisma, Next.js, React and KiCad compatibility updates require manual review.
- Only low-risk development dependency and `@types/*` patch/minor updates may receive the `automerge` label; Mergify remains responsible for the actual post-CI merge.
- Renovate itself never directly merges pull requests.

### Operational verification

Repository-owned verification covers two layers:

1. Static validation: the config parses, uses the expected managers/rules, and references only repository labels that exist.
2. GitHub operation: the Renovate App is installed, a Dependency Dashboard exists or a deliberate onboarding run produces one, and a dry-run/log review shows the repository is not ignored or disabled.

If the App cannot be forced to run through available automation, the repository documents the exact GitHub UI action required and records the last verified date.

## Local security gates

### Pre-commit

The pre-commit stage must remain fast and offline-capable after initial tool installation. It runs:

- trailing whitespace/end-of-file/YAML/JSON/private-key checks;
- Gitleaks;
- Biome on staged JavaScript, TypeScript, JSON, YAML and Markdown files;
- repository-owned Semgrep rules on staged JavaScript and TypeScript files.

Semgrep uses a committed `.semgrep.yml` and `.semgrepignore`, disables metrics, and does not require a Semgrep account or token.

Initial high-confidence rules cover:

- dynamic code execution through `eval`, `Function` and equivalent constructors;
- shell-enabled child process execution in production code;
- disabled TLS certificate verification;
- unsafe command construction patterns where a direct repository-specific match can avoid false positives.

Intentional fixtures are isolated under `tests/semgrep` and excluded from production scans except during rule tests.

### Pre-push

The pre-push stage runs networked or broader checks:

- full repository Semgrep validation/rule tests/scan;
- Snyk Open Source scan using a version-pinned CLI and `--all-projects --severity-threshold=high`;
- existing repository pre-push checks continue to run.

Missing Snyk authentication is a visible failure, not a silent skip. Emergency bypass uses pre-commit's explicit `SKIP=snyk-oss` mechanism and is documented as exceptional; required PR checks remain authoritative.

Snyk Code is exposed as an explicit developer command rather than a mandatory pre-push hook because it is slower, network-dependent, and may require separate entitlement or authentication behavior.

## SonarQube Cloud local workflow

SonarQube Cloud remains the authoritative repository quality gate. Developers use SonarQube for IDE Connected Mode to receive the repository's quality profile and issue context locally.

The repository documents:

- installation of the SonarQube for IDE extension/plugin;
- connecting to the BoardReadyOps SonarQube Cloud project;
- secure token handling outside the repository;
- synchronization and troubleshooting;
- the distinction between IDE feedback and the required PR analysis.

An explicit `sonar:scan` command may be documented for maintainers, but it is not installed as a pre-commit hook and must require externally supplied credentials.

## CI changes

A focused static-security workflow or focused jobs in the existing security workflow will:

- validate `.semgrep.yml`;
- run Semgrep rule tests;
- scan the repository with SARIF output;
- upload SARIF on trusted events;
- validate `renovate.json` with a pinned Renovate version;
- run a repository policy test that prevents accidental weakening or removal of these controls.

The workflow uses pinned action SHAs, minimal permissions, explicit timeouts and no committed cloud token.

## Repository labels

The following labels must exist because Renovate/Mergify policy references them:

- `automerge`
- `manual-review`
- `breaking-change`
- `supply-chain`
- `types`
- `lockfile-maintenance`

Existing `dependencies` and `security` labels are retained. Label creation is an explicit repository mutation and descriptions/colors are standardized.

## Testing strategy

### Repository policy tests

A Vitest test reads repository configuration and asserts:

- Renovate managers, schedule, package groups, release-age policy and manual-review boundaries;
- no Dependabot version-update config exists;
- all Renovate/Mergify labels are declared in the policy documentation;
- pre-commit and pre-push stages contain the expected tools;
- Semgrep and Snyk versions are pinned;
- Sonar Connected Mode documentation exists;
- CI validates Renovate and Semgrep.

### Semgrep tests

`semgrep --test` fixtures prove every custom rule has positive and negative cases. A full local scan must produce zero findings in production source before merge.

### Config validation

Renovate validation runs under Node.js 24.11 or newer, matching the current Renovate engine requirement. It validates the repository config without requiring a GitHub token by invoking the local config validator mode rather than a repository run.

### Final verification

Run:

- focused policy tests;
- Semgrep validation, rule tests and full scan;
- pre-commit configuration validation and all non-authenticated hooks;
- Snyk CLI version/help validation, plus a real authenticated scan when a token is available;
- root lint, typecheck, Knip and relevant unit tests;
- `git diff --check` and secret scan;
- GitHub CI/security checks on the pull request.

## Rollout

1. Merge repository configuration, tests, hooks and documentation.
2. Create missing labels.
3. Confirm or repair Renovate App onboarding and produce the Dependency Dashboard.
4. Install both pre-commit and pre-push hooks in maintainer environments.
5. Authenticate Snyk locally with `snyk auth` or `SNYK_TOKEN`.
6. Connect SonarQube for IDE to the Cloud project.
7. Observe the first Renovate maintenance window and review grouping/labels before allowing Mergify automerge.

## Acceptance criteria

- `renovate.json` validates and has BoardReadyOps-specific grouping, stability and manual-review policy.
- Renovate is operationally proven by a Dashboard/onboarding result or an explicit documented blocker.
- Every label referenced by Renovate/Mergify exists.
- No duplicate routine dependency updater is configured.
- Staged production source receives token-free Semgrep feedback before commit.
- Full Semgrep and authenticated Snyk Open Source scans run before push.
- SonarQube Cloud remains the PR gate and Connected Mode is documented for local use.
- CI enforces Renovate/Semgrep configuration and repository policy tests.
- No credentials are committed and all new third-party versions/actions are pinned.
