# Local Security Tooling

BoardReadyOps combines fast local feedback with authoritative pull-request security checks. Local tools do not replace CodeQL, Dependency Review, OSV, Gitleaks, Snyk, Socket, or SonarQube Cloud checks in GitHub.

## Install the Git hooks

Use the repository-pinned Node.js and pnpm versions, then install pre-commit 4.6.0 in an isolated Python environment:

```bash
python3 -m venv .venv-pre-commit
.venv-pre-commit/bin/python -m pip install pre-commit==4.6.0
.venv-pre-commit/bin/pre-commit install --hook-type pre-commit --hook-type pre-push
```

The generated hook scripts invoke the committed `.pre-commit-config.yaml`.

### Pre-commit checks

The commit stage runs:

- whitespace, file-ending, YAML, JSON, case-conflict, large-file, and private-key checks;
- Gitleaks;
- Biome on staged supported files;
- BoardReadyOps Semgrep rules on staged production JavaScript and TypeScript files.

Run the same stage manually:

```bash
.venv-pre-commit/bin/pre-commit run --all-files --hook-stage pre-commit
```

### Pre-push checks

The push stage runs the full Semgrep rule tests and repository scan, followed by Snyk Open Source scanning at high severity or above.

```bash
.venv-pre-commit/bin/pre-commit run --all-files --hook-stage pre-push
```

The existing Husky pre-push hook continues to run type checking, unit tests, and distribution verification.

## Semgrep

Rules are stored in `.semgrep.yml`. They are repository-owned, do not contact the Semgrep registry, and run with metrics disabled.

```bash
pnpm security:semgrep:test
pnpm security:semgrep
```

The current rules reject dynamic code execution, shell-backed child processes, and disabled TLS certificate verification. Positive and negative fixtures live under `tests/semgrep`; the copied test config is checked against `.semgrep.yml` by the repository policy test.

A finding should normally be fixed in production code. Narrow a rule only when a reproducible negative fixture proves a false positive.

## Snyk

The Snyk CLI version is pinned in package scripts. Authenticate without writing a token to the repository:

```bash
pnpm dlx snyk@1.1306.1 auth
# Equivalent installed-CLI form:
snyk auth
```

CI or non-interactive environments should provide `SNYK_TOKEN` through their secret manager. Run the Open Source dependency scan with:

```bash
pnpm security:snyk:oss
```

Snyk Code remains an explicit, optional local command because it is slower and service-dependent:

```bash
pnpm security:snyk:code
```

Missing authentication fails the pre-push hook visibly. During an exceptional incident, a maintainer can bypass only that local hook:

```bash
SKIP=snyk-oss git push
```

This bypass is not routine and does not bypass required GitHub checks. Document the reason in the pull request when it is used.

## SonarQube Cloud Connected Mode

SonarQube Cloud remains the authoritative pull-request quality gate. Do not add a token-bearing Sonar scanner to pre-commit.

For local feedback, install **SonarQube for IDE** in VS Code, IntelliJ IDEA, or another supported IDE and enable **Connected Mode**:

1. Create a SonarQube Cloud user token in your own account.
2. Store the token in the IDE's secure credential storage, never in repository files or shell history.
3. Add a connection to SonarQube Cloud.
4. Bind the workspace to the BoardReadyOps project shown by the repository's SonarQube Cloud check.
5. Update project bindings after quality-profile or server changes.

Connected Mode synchronizes quality profiles and issue context for editor feedback. The GitHub pull-request analysis remains required and authoritative because it evaluates the complete branch and server-side configuration.

## Troubleshooting

Validate configuration independently:

```bash
pnpm renovate:validate
semgrep --validate --config .semgrep.yml
.venv-pre-commit/bin/pre-commit validate-config
```

When the `pnpm` command resolves through a version-manager shim, ensure the repository-pinned Node.js and pnpm versions are activated before running hooks. Never solve an authentication error by committing credentials or weakening a required check.
