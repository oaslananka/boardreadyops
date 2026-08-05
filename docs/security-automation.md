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

The aggregate security workflow calls the official OSV reusable workflows through an immutable v2.3.8 commit SHA. Dependency-changing pull requests run a differential scan with SARIF upload disabled so fork pull requests remain tokenless and read-only. Trusted pushes and manually dispatched aggregate runs use the full recursive scan, and `security / gate` owns the merge decision.

`.github/workflows/osv.yml` is the single scheduled specialist advisory scan and publishes the full recursive result to GitHub Code Scanning. It does not run on pull requests or pushes, so the same OSV inventory is not scanned twice for an automatic repository event. A maintainer may still dispatch the specialist workflow manually when independent SARIF evidence is required.

## Security dependency updates and release quarantine

Routine dependency releases remain quarantined for seven days by Renovate, `.npmrc`, and pnpm workspace policy. Renovate vulnerability alerts explicitly bypass that waiting period, remain manual-review only, and request the lowest known-safe version. Exact safe versions needed to regenerate the lockfile are listed in `minimumReleaseAgeExclude`; bounded override selectors apply only below the safe floor, so a future parent dependency that already resolves a safe version is not forced backward.

## Package-manager supply-chain policy

The repository enforces a seven-day release quarantine in npm, pnpm, and every Renovate package rule. pnpm additionally blocks exotic transitive dependency sources and rejects package metadata trust downgrades. These controls reduce exposure to newly published malicious or compromised packages before they enter the lockfile.

Security fixes sometimes need to land before the normal quarantine expires. `pnpm-workspace.yaml` therefore uses exact package-and-version exclusions only for reviewed urgent fixes already present in the lockfile. Trust exceptions are also exact-version entries and must remain minimal. Do not add package-wide wildcards or disable the global policies to unblock an update; remove each temporary release-age exclusion after the package is older than seven days.

## Container runtime privilege policy

The hosted cloud image owns its copied runtime artifacts as the built-in `node` account and declares `USER node` before the health check and entrypoint. The published GitHub Docker action remains an explicit exception because GitHub mounts `GITHUB_WORKSPACE` with runner-dependent ownership and the action must be able to read and write that workspace. The action Dockerfile documents this constraint next to a rule-specific Semgrep suppression; the exception does not apply to standalone or hosted service images.

## Aggregate merge gate

Every pull request receives one stable `security / gate` conclusion from `.github/workflows/security.yml`. A policy job classifies the changed files, then the gate evaluates all applicable mandatory checks after they complete:

- CodeQL and Semgrep for executable or workflow changes;
- Gitleaks for every pull request;
- Dependency Review and the OSV differential scan for dependency inventory changes;
- repository license, NOTICE, REUSE, and supply-chain compliance for release, dependency, workflow, or security-policy changes; and
- CycloneDX SBOM generation when the dependency inventory or security configuration changes.

An applicable check must finish with `success`. Failure, cancellation, or an unexpected skip blocks the aggregate gate. Checks that are not applicable remain visible in the job summary with the policy reason; they are never inferred from a missing status. Fork pull requests run with read-only permissions. CodeQL is explicitly non-applicable for a fork because SARIF publication requires a trusted context, while Semgrep, Gitleaks, Dependency Review, OSV, and repository compliance continue without repository secrets.

The `main` ruleset requires only the stable aggregate security context. Individual scanner jobs remain visible for diagnosis and code-scanning publication but are implementation details rather than branch-protection contracts. OpenSSF Scorecard, Trivy schedules, SonarQube Cloud Automatic Analysis, Socket, DeepScan, and other hosted integrations remain advisory unless separately promoted through a reviewed policy change.

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
- Gitleaks, Dependency Review, CodeQL, Semgrep, OSV, repository compliance, and required SBOM generation feed the stable `security / gate` conclusion according to the change policy.
- Trivy, Scorecard, SonarQube Cloud, and other specialist integrations remain advisory unless the committed merge policy explicitly promotes them.
- Sonar status is reported by the SonarQube Cloud integration rather than a repository scanner workflow.
