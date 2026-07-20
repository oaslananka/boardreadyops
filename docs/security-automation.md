# Security Automation

BoardReadyOps uses layered local and hosted checks. Local hooks provide fast feedback; GitHub Actions remains the authoritative enforcement boundary.

## Local prerequisites

The repository uses Husky as the Git hook owner. Install the Python pre-commit runner, then install project dependencies:

```bash
python -m pip install "pre-commit>=4.6.0,<5"
corepack pnpm install --frozen-lockfile
```

Do not run `pre-commit install`; `scripts/prepare.mjs` configures `.husky` as the Git hooks path. Husky invokes the pre-commit framework directly.

## Pre-commit checks

`.husky/pre-commit` runs staged Biome formatting first and then `pre-commit run --hook-stage pre-commit`.

`.pre-commit-config.yaml` pins:

- general file-integrity hooks;
- Gitleaks for committed-secret detection;
- Semgrep `v1.170.0` with the project rule set in `.semgrep.yml`.

The Semgrep hook examines staged JavaScript and TypeScript files and rejects shell-command-string execution through Node's `child_process` APIs. Full CI still runs when a local hook is explicitly bypassed.

## Pre-push checks

`.husky/pre-push` retains the repository typecheck, unit-test, and distribution verification gates, then runs the pre-push stage for all files.

The `snyk-oss` hook executes the pinned Snyk CLI against all detected pnpm workspace projects and includes development dependencies. It is intentionally pre-push rather than pre-commit because it needs network access and authentication.

Authenticate locally with either:

```bash
corepack pnpm --config.ignore-scripts=true --package=snyk@1.1306.1 dlx snyk auth
```

or an externally supplied `SNYK_TOKEN`. Credentials must never be written to repository files.

## Semgrep CI

The `security / semgrep` job:

1. installs the pinned Semgrep CLI;
2. enforces `.semgrep.yml` as a blocking project gate;
3. runs broader TypeScript, Node.js, OWASP Top 10, and GitHub Actions community rules;
4. uploads SARIF to GitHub Code Scanning for trusted contexts.

The project-specific rule set is intentionally small and high-confidence. Broader community results are visible in SARIF without making existing advisory findings indistinguishable from newly introduced project-policy violations.

## Snyk CI

The `security / snyk` job runs only on trusted repository events so secrets are never exposed to fork pull requests. It resolves the exact Snyk CLI `1.1306.1` package with lifecycle scripts disabled, scans every detected pnpm workspace project, includes development dependencies, and blocks high or critical open-source findings.

The preferred repository secret is `SNYK_TOKEN`. The workflow temporarily supports the existing misspelled `SYNK_PAT_TOKEN` secret so migration can occur without an outage. After `SNYK_TOKEN` is configured and a successful workflow run is observed, delete `SYNK_PAT_TOKEN`.

The pnpm workspace policy forces known vulnerable transitive releases to patched versions. The Snyk command excludes `requirements.txt` manifests because Python documentation dependencies are pinned separately and covered by the existing OSV job. `.snyk` contains exactly one temporary exception for `SNYK-JS-EXTRACTZIP-17660777`: the dependency is development-only, Puppeteer install scripts are disabled, no upstream patched release is available, and the exception expires on August 31, 2026.

## SonarQube Cloud

SonarQube Cloud Automatic Analysis remains the authoritative Sonar mode. `.sonarcloud.properties` excludes generated outputs, tests, dependencies, and SQL migration snapshots from main-code analysis.

Do not add `SonarSource/sonarqube-scan-action` while Automatic Analysis is enabled. Switching to CI-based analysis requires first disabling Automatic Analysis in the SonarQube Cloud project settings and then adding the scanner workflow deliberately.

Developers who need local Sonar feedback should use SonarQube for IDE Connected Mode and store the connection token in the IDE or operating-system credential store, never in this repository.

## Failure handling

- Semgrep project-rule findings fail local commit and hosted security checks.
- Snyk high/critical findings fail local push and hosted security checks.
- Missing or invalid Snyk authentication is a visible failure and never prints the token.
- Sonar status is reported by the SonarQube Cloud integration rather than a repository scanner workflow.
