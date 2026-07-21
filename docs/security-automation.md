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
- Semgrep `v1.170.0` with the project rule set in `.semgrep.yml`;
- actionlint v1.7.12 for GitHub Actions syntax and semantic validation;
- zizmor v1.27.0 for GitHub Actions security analysis at medium severity and above;
- OSV-Scanner v2.3.8 as an explicit manual dependency vulnerability scan.

The Semgrep hook examines staged JavaScript and TypeScript files and rejects shell-command-string execution through Node's `child_process` APIs. actionlint and zizmor examine changed workflow YAML files. Full CI runs both workflow linters over every workflow even when a local hook is explicitly bypassed.

## Manual dependency scan

Dependency scanning is manual locally because it refreshes vulnerability data from the network. Run it before dependency, release, or lockfile-sensitive changes with:

```bash
pre-commit run --hook-stage manual osv-scanner --all-files
```

The pinned hook recursively scans supported manifests and lockfiles from the repository root. No account, API token, or hosted scan quota is required. Findings are matched against the open OSV vulnerability database.

## OSV CI

`.github/workflows/osv.yml` owns dependency vulnerability enforcement:

1. pull requests run the official differential reusable workflow and fail when the proposed change introduces a vulnerability;
2. pushes to `main`, weekly schedules, and manual dispatches run a complete recursive source scan;
3. the official reusable workflows publish SARIF to GitHub Code Scanning;
4. both modes use OSV-Scanner v2.3.8 through an immutable full commit SHA;
5. all jobs operate with read-only repository access plus the minimum `security-events: write` permission required for SARIF.

The workflow is path-filtered for package manifests, lockfiles, workspace configuration, Python requirement files, and its own workflow definition. Scheduled scans still detect newly disclosed vulnerabilities even when dependencies have not changed.

## Semgrep CI

The `security / semgrep` job:

1. installs the pinned Semgrep CLI;
2. enforces `.semgrep.yml` as a blocking project gate;
3. runs broader TypeScript, Node.js, OWASP Top 10, and GitHub Actions community rules;
4. uploads SARIF to GitHub Code Scanning for trusted contexts.

The project-specific rule set is intentionally small and high-confidence. Broader community results are visible in SARIF without making existing advisory findings indistinguishable from newly introduced project-policy violations.

## Complementary security ownership

The security stack intentionally gives each category a primary owner:

- OSV-Scanner: dependency and lockfile vulnerabilities;
- GitHub Dependency Review: newly introduced vulnerable dependencies in pull requests;
- CodeQL and Semgrep: source-code security analysis;
- Gitleaks and GitHub push protection: secrets;
- Trivy: scheduled filesystem, container, and infrastructure-as-code coverage;
- OpenSSF Scorecard: repository supply-chain posture;
- the SBOM job: CycloneDX dependency inventory.

This avoids adding multiple hosted scanners that report the same dependency findings while preserving independent coverage for source code, secrets, workflow configuration, containers, and supply-chain controls.

## SonarQube Cloud

SonarQube Cloud Automatic Analysis remains the authoritative Sonar mode. `.sonarcloud.properties` excludes generated outputs, tests, dependencies, and SQL migration snapshots from main-code analysis.

Do not add `SonarSource/sonarqube-scan-action` while Automatic Analysis is enabled. Switching to CI-based analysis requires first disabling Automatic Analysis in the SonarQube Cloud project settings and then adding the scanner workflow deliberately.

Developers who need local Sonar feedback should use SonarQube for IDE Connected Mode and store the connection token in the IDE or operating-system credential store, never in this repository.

## Failure handling

- Semgrep project-rule findings fail local commit and hosted security checks.
- OSV pull-request scans fail when a change introduces a known vulnerability.
- OSV complete scans fail when any supported manifest or lockfile resolves to a known vulnerability.
- Gitleaks, dependency review, CodeQL, Trivy, and repository policy checks retain their existing enforcement behavior.
- Sonar status is reported by the SonarQube Cloud integration rather than a repository scanner workflow.
