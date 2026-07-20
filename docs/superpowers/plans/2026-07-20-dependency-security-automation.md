# Dependency and Local Security Automation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Renovate operationally verifiable and BoardReadyOps-specific, add deterministic Semgrep/Snyk local gates, and document SonarQube Cloud Connected Mode without duplicating existing cloud security checks.

**Architecture:** Repository-owned policy tests define the automation contract. `renovate.json` remains the dependency-update source of truth, `.pre-commit-config.yaml` orchestrates fast pre-commit and networked pre-push checks, `.semgrep.yml` owns token-free static rules, and a focused GitHub Actions workflow validates Renovate/Semgrep configuration and uploads SARIF. SonarQube Cloud remains the PR gate; local feedback is delivered through Connected Mode.

**Tech Stack:** Renovate 43.272.4, pre-commit 4.6.0, Semgrep CE 1.170.0, Snyk CLI 1.1306.1, pnpm 11.8.0, Node.js 24, Vitest 4, GitHub Actions, SARIF.

## Global Constraints

- Renovate is the only routine version-update bot; do not add Dependabot version-update configuration.
- GitHub vulnerability alerts and security updates remain enabled.
- Do not commit Renovate, Snyk, Semgrep or SonarQube credentials.
- Semgrep local/CI scans use repository-owned rules and `--metrics=off`.
- Full Snyk Open Source scanning runs at pre-push, not pre-commit.
- SonarQube Cloud remains the authoritative PR quality gate; no mandatory local scanner hook is added.
- GitHub Actions and container updates remain digest-pinned and manually reviewed.
- Major, `0.x`, Node.js, pnpm, TypeScript, Prisma, Next.js, React and KiCad compatibility updates do not receive automerge.
- Third-party action SHAs and CLI versions are pinned.
- Repository hooks remain installable with `pre-commit install --hook-type pre-commit --hook-type pre-push`.

---

## File Map

- Modify `renovate.json`: BoardReadyOps-specific scheduling, grouping, release-age, manual-review and automerge boundaries.
- Create `tests/unit/repository/dependency-security-automation-policy.test.ts`: repository automation contract.
- Modify `.pre-commit-config.yaml`: staged Biome/Semgrep and pre-push full Semgrep/Snyk hooks.
- Create `.semgrep.yml`: repository-owned high-confidence rules.
- Create `.semgrepignore`: generated/vendor/intentional-fixture exclusions.
- Create `tests/semgrep/security-rules.ts`: positive and negative Semgrep rule fixtures.
- Modify `package.json`: pinned security and Renovate validation commands.
- Create `.github/workflows/static-security-analysis.yml`: Renovate validation, Semgrep tests/scan and SARIF upload.
- Create `docs/development/security-tooling.md`: setup, Snyk authentication, bypass policy and Sonar Connected Mode.
- Modify `CONTRIBUTING.md`: link the security tooling guide and hook installation.
- Modify `docs/dependency-automation.md`: operational Renovate verification and label policy.
- Modify `docs/security/threat-model.md`: record local/static controls and tool responsibilities.
- Create missing GitHub labels referenced by Renovate/Mergify.

---

### Task 1: Repository automation contract

**Files:**
- Create: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Consumes: repository text files and `package.json`.
- Produces: one Vitest policy suite that defines required Renovate, hook, Semgrep, Snyk, Sonar and CI behavior.

- [ ] **Step 1: Write the failing repository policy test**

Create a test that reads files relative to the repository root and asserts:

```ts
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const readText = (path: string): string => {
  const absolutePath = resolve(repositoryRoot, path);
  return existsSync(absolutePath) ? readFileSync(absolutePath, "utf8") : "";
};
const packageJson = JSON.parse(readText("package.json")) as { scripts?: Record<string, string> };
const renovate = JSON.parse(readText("renovate.json")) as Record<string, unknown>;

const SEMGREP_VERSION = "1.170.0";
const SNYK_VERSION = "1.1306.1";
const RENOVATE_VERSION = "43.272.4";

describe("dependency and local security automation policy", () => {
  it("keeps Renovate as the single routine dependency updater", () => {
    expect(readText(".github/dependabot.yml")).toBe("");
    expect(renovate).toMatchObject({
      timezone: "Europe/Istanbul",
      dependencyDashboard: true,
      enabledManagers: ["npm", "github-actions", "dockerfile", "docker-compose"],
      platformAutomerge: false,
    });
  });

  it("defines BoardReadyOps-specific stability and manual-review rules", () => {
    const config = readText("renovate.json");
    expect(config).toContain("minimumReleaseAge");
    expect(config).toContain("matchCurrentVersion");
    expect(config).toContain("/^0\\./");
    expect(config).toContain("Next.js and React");
    expect(config).toContain("TypeScript and type tooling");
    expect(config).toContain("Prisma and PostgreSQL tooling");
    expect(config).toContain("supply-chain");
    expect(config).toContain("manual-review");
  });

  it("pins and exposes local security commands", () => {
    expect(packageJson.scripts?.["security:semgrep"]).toBe(
      "semgrep scan --config .semgrep.yml --error --metrics=off .",
    );
    expect(packageJson.scripts?.["security:semgrep:test"]).toBe(
      "semgrep --test --config .semgrep.yml tests/semgrep",
    );
    expect(packageJson.scripts?.["security:snyk:oss"]).toBe(
      `pnpm dlx snyk@${SNYK_VERSION} test --all-projects --severity-threshold=high`,
    );
    expect(packageJson.scripts?.["renovate:validate"]).toBe(
      `pnpm dlx renovate@${RENOVATE_VERSION} renovate-config-validator renovate.json`,
    );
  });

  it("installs staged Semgrep and pre-push Snyk hooks", () => {
    const config = readText(".pre-commit-config.yaml");
    expect(config).toContain("default_install_hook_types:");
    expect(config).toContain("- pre-commit");
    expect(config).toContain("- pre-push");
    expect(config).toContain(`rev: v${SEMGREP_VERSION}`);
    expect(config).toContain("--config=.semgrep.yml");
    expect(config).toContain("id: snyk-oss");
    expect(config).toContain("entry: pnpm security:snyk:oss");
    expect(config).toContain("stages: [pre-push]");
  });

  it("runs Renovate and Semgrep validation in CI", () => {
    const workflow = readText(".github/workflows/static-security-analysis.yml");
    expect(workflow).toContain(`renovate@${RENOVATE_VERSION}`);
    expect(workflow).toContain(`semgrep==${SEMGREP_VERSION}`);
    expect(workflow).toContain("semgrep --validate --config .semgrep.yml");
    expect(workflow).toContain("semgrep --test --config .semgrep.yml tests/semgrep");
    expect(workflow).toContain("github/codeql-action/upload-sarif@");
  });

  it("documents Snyk authentication and Sonar Connected Mode", () => {
    const guide = readText("docs/development/security-tooling.md");
    expect(guide).toContain("snyk auth");
    expect(guide).toContain("SKIP=snyk-oss");
    expect(guide).toContain("SonarQube for IDE");
    expect(guide).toContain("Connected Mode");
  });
});
```

- [ ] **Step 2: Run the policy test and verify RED**

Run:

```bash
corepack pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
```

Expected: FAIL because the new scripts, hooks, workflow and guide are not present.

- [ ] **Step 3: Commit the red-phase policy test**

```bash
git add tests/unit/repository/dependency-security-automation-policy.test.ts
git commit -m "test(security): define automation policy"
```

---

### Task 2: Renovate policy and validation

**Files:**
- Modify: `renovate.json`
- Modify: `package.json`
- Modify: `docs/dependency-automation.md`
- Test: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Produces package script `renovate:validate`.
- Produces labels referenced by configuration: `dependencies`, `automerge`, `manual-review`, `breaking-change`, `supply-chain`, `types`, `lockfile-maintenance`, `security`.

- [ ] **Step 1: Update Renovate configuration**

Keep existing presets and add:

```json
{
  "dependencyDashboard": true,
  "platformAutomerge": false,
  "schedule": ["after 2am and before 6am on monday"],
  "minimumReleaseAge": "3 days",
  "prCreation": "not-pending",
  "internalChecksFilter": "strict",
  "rebaseWhen": "behind-base-branch",
  "packageRules": [
    {
      "description": "Never automerge unstable zero-major dependencies.",
      "matchCurrentVersion": "/^0\\./",
      "automerge": false,
      "addLabels": ["manual-review"]
    },
    {
      "description": "Coordinate TypeScript and type tooling updates.",
      "matchPackageNames": ["typescript", "tsx", "ts-node", "/^@types\\//"],
      "groupName": "TypeScript and type tooling"
    },
    {
      "description": "Coordinate Vitest test tooling updates.",
      "matchPackageNames": ["vitest", "/^@vitest\\//"],
      "groupName": "Vitest test tooling"
    },
    {
      "description": "Coordinate Next.js and React runtime updates with manual review.",
      "matchPackageNames": ["next", "react", "react-dom", "/^@types\\/react/"],
      "groupName": "Next.js and React",
      "automerge": false,
      "addLabels": ["manual-review"]
    },
    {
      "description": "Coordinate Prisma and PostgreSQL tooling updates with manual review.",
      "matchPackageNames": ["prisma", "@prisma/client", "pg", "@types/pg"],
      "groupName": "Prisma and PostgreSQL tooling",
      "automerge": false,
      "addLabels": ["manual-review"]
    },
    {
      "description": "Keep Node.js and pnpm toolchain updates manual.",
      "matchDepNames": ["node", "pnpm"],
      "automerge": false,
      "addLabels": ["manual-review"]
    }
  ]
}
```

Merge these rules with the existing major, TypeScript, `@types/*`, dev-dependency and supply-chain rules. Do not duplicate rule intent. Add `minimumReleaseAge: "7 days"` to TypeScript/Next.js/React/Prisma/toolchain rules where compatibility risk is higher. Keep vulnerability alerts unscheduled.

- [ ] **Step 2: Add a pinned Renovate validator command**

Add to `package.json`:

```json
"renovate:validate": "pnpm dlx renovate@43.272.4 renovate-config-validator renovate.json"
```

- [ ] **Step 3: Document operational verification**

Update `docs/dependency-automation.md` with:

- the weekly schedule and release-age policy;
- all required labels;
- how to verify the Renovate GitHub App is installed;
- how to trigger/check onboarding through the Dependency Dashboard;
- the latest verification date and known result;
- the fact that Renovate has not yet produced a Dashboard/PR and must be verified after merge.

- [ ] **Step 4: Validate Renovate config and policy test**

Run under Node.js 24.11 or newer:

```bash
mise exec node@24.18.0 -- corepack pnpm run renovate:validate
corepack pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
```

Expected: Renovate validation PASS; policy test still fails only for not-yet-implemented security files.

- [ ] **Step 5: Commit Renovate policy**

```bash
git add renovate.json package.json docs/dependency-automation.md
git commit -m "chore(deps): harden Renovate policy"
```

---

### Task 3: Semgrep rules and developer commands

**Files:**
- Create: `.semgrep.yml`
- Create: `.semgrepignore`
- Create: `tests/semgrep/security-rules.ts`
- Modify: `package.json`
- Test: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Produces rule IDs:
  - `boardreadyops.security.no-dynamic-code-execution`
  - `boardreadyops.security.no-shell-child-process`
  - `boardreadyops.security.no-disabled-tls-verification`
- Produces scripts `security:semgrep`, `security:semgrep:test`, `security:snyk:oss`, `security:snyk:code`, `security:snyk`.

- [ ] **Step 1: Create Semgrep positive/negative fixtures**

Create `tests/semgrep/security-rules.ts` with `// ruleid:` and `// ok:` annotations for:

```ts
// ruleid: boardreadyops.security.no-dynamic-code-execution
eval(userInput);
// ruleid: boardreadyops.security.no-dynamic-code-execution
new Function(userInput);
// ok: boardreadyops.security.no-dynamic-code-execution
JSON.parse(userInput);

// ruleid: boardreadyops.security.no-shell-child-process
exec(userInput);
// ruleid: boardreadyops.security.no-shell-child-process
spawn("sh", ["-c", userInput]);
// ok: boardreadyops.security.no-shell-child-process
execFile("git", ["status", "--short"]);

// ruleid: boardreadyops.security.no-disabled-tls-verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// ruleid: boardreadyops.security.no-disabled-tls-verification
new https.Agent({ rejectUnauthorized: false });
// ok: boardreadyops.security.no-disabled-tls-verification
new https.Agent({ rejectUnauthorized: true });
```

- [ ] **Step 2: Run rule tests and verify RED**

```bash
semgrep --test --config .semgrep.yml tests/semgrep
```

Expected: FAIL because `.semgrep.yml` does not exist.

- [ ] **Step 3: Implement repository-owned rules and ignore policy**

Create `.semgrep.yml` using JavaScript/TypeScript languages, `ERROR` severity and focused patterns. Exclude test fixtures, generated files, dependencies, coverage, `.next`, `dist`, temporary files and docs through `.semgrepignore`.

- [ ] **Step 4: Add pinned commands**

Add to `package.json`:

```json
"security:semgrep": "semgrep scan --config .semgrep.yml --error --metrics=off .",
"security:semgrep:test": "semgrep --test --config .semgrep.yml tests/semgrep",
"security:snyk:oss": "pnpm dlx snyk@1.1306.1 test --all-projects --severity-threshold=high",
"security:snyk:code": "pnpm dlx snyk@1.1306.1 code test --severity-threshold=high",
"security:snyk": "pnpm security:snyk:oss && pnpm security:snyk:code"
```

- [ ] **Step 5: Validate rules and scan production source**

```bash
semgrep --validate --config .semgrep.yml
corepack pnpm run security:semgrep:test
corepack pnpm run security:semgrep
```

Expected: validation PASS, rule tests PASS, production scan exits 0 with no findings. If a true-positive existing finding is discovered, fix the production code rather than weakening the rule. If a false positive is discovered, narrow the pattern and add a negative fixture.

- [ ] **Step 6: Commit Semgrep and security commands**

```bash
git add .semgrep.yml .semgrepignore tests/semgrep/security-rules.ts package.json
git commit -m "feat(security): add repository Semgrep rules"
```

---

### Task 4: Pre-commit and pre-push orchestration

**Files:**
- Modify: `.pre-commit-config.yaml`
- Test: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Produces pre-commit hooks `biome-staged` and Semgrep staged scan.
- Produces pre-push hooks `semgrep-full` and `snyk-oss`.

- [ ] **Step 1: Extend pre-commit installation stages**

Add:

```yaml
default_install_hook_types:
  - pre-commit
  - pre-push
```

Keep existing hooks and add `check-case-conflict` and `check-added-large-files` with an explicit maximum size suitable for source files.

- [ ] **Step 2: Add staged Biome hook**

Add a local hook:

```yaml
  - repo: local
    hooks:
      - id: biome-staged
        name: Biome staged-file checks
        entry: pnpm exec biome check --no-errors-on-unmatched
        language: system
        types_or: [javascript, jsx, ts, tsx, json, yaml, markdown]
        stages: [pre-commit]
```

Use actual pre-commit-supported types. If `ts`/`tsx` are not valid built-in types, use a filename regex instead.

- [ ] **Step 3: Add staged Semgrep and pre-push hooks**

Add Semgrep `v1.170.0` for staged JavaScript/TypeScript files with:

```yaml
args: ["--config=.semgrep.yml", "--error", "--metrics=off"]
stages: [pre-commit]
```

Add local pre-push hooks:

```yaml
      - id: semgrep-full
        name: Semgrep full repository scan
        entry: pnpm security:semgrep:test && pnpm security:semgrep
        language: system
        pass_filenames: false
        stages: [pre-push]
      - id: snyk-oss
        name: Snyk Open Source high-severity scan
        entry: pnpm security:snyk:oss
        language: system
        pass_filenames: false
        stages: [pre-push]
```

- [ ] **Step 4: Validate hook configuration**

Use an isolated Python environment if needed:

```bash
pre-commit validate-config
pre-commit run --all-files --hook-stage pre-commit
SKIP=snyk-oss pre-commit run --all-files --hook-stage pre-push
```

Expected: all non-Snyk hooks PASS. Do not bypass a real Semgrep finding.

- [ ] **Step 5: Commit hook orchestration**

```bash
git add .pre-commit-config.yaml
git commit -m "feat(security): add local analysis gates"
```

---

### Task 5: CI validation and SARIF

**Files:**
- Create: `.github/workflows/static-security-analysis.yml`
- Test: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Produces GitHub checks `static-security / policy` and `static-security / semgrep`.

- [ ] **Step 1: Create a pinned workflow**

Create a workflow triggered on pull requests, pushes to `main`, weekly schedule and manual dispatch. Use:

- `contents: read` globally;
- `security-events: write` only for the SARIF job;
- Ubuntu 24.04;
- Node.js 24;
- Python 3.13 or `uv` for pinned Semgrep installation;
- explicit 10-15 minute timeouts;
- concurrency with PR cancellation.

- [ ] **Step 2: Add policy/validator job**

The policy job checks out with `persist-credentials: false`, installs pnpm dependencies, and runs:

```bash
pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
pnpm run renovate:validate
```

Provide a non-secret placeholder `DATABASE_URL=postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_ci` only if Knip/Prisma config loading requires it.

- [ ] **Step 3: Add Semgrep job**

Install `semgrep==1.170.0`, then run:

```bash
semgrep --validate --config .semgrep.yml
semgrep --test --config .semgrep.yml tests/semgrep
semgrep scan --config .semgrep.yml --error --metrics=off --sarif --output semgrep.sarif .
```

Upload SARIF using the repository's already pinned `github/codeql-action/upload-sarif` SHA. For untrusted fork events, run the scan but guard SARIF upload according to the repository's existing trusted-event policy.

- [ ] **Step 4: Validate workflow and policy test**

```bash
corepack pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
corepack pnpm biome check .github/workflows/static-security-analysis.yml
```

Expected: PASS.

- [ ] **Step 5: Commit CI workflow**

```bash
git add .github/workflows/static-security-analysis.yml
git commit -m "ci(security): validate Renovate and Semgrep"
```

---

### Task 6: Developer documentation and Sonar Connected Mode

**Files:**
- Create: `docs/development/security-tooling.md`
- Modify: `CONTRIBUTING.md`
- Modify: `docs/security/threat-model.md`.
- Modify: `docs/dependency-automation.md`
- Test: `tests/unit/repository/dependency-security-automation-policy.test.ts`

**Interfaces:**
- Produces maintainer setup and troubleshooting contract.

- [ ] **Step 1: Document hook installation and commands**

Include exact commands:

```bash
python -m pip install pre-commit==4.6.0
pre-commit install --hook-type pre-commit --hook-type pre-push
pnpm security:semgrep:test
pnpm security:semgrep
snyk auth
pnpm security:snyk:oss
```

Explain that `SKIP=snyk-oss git push` is exceptional, visible in shell history, and does not bypass required PR checks.

- [ ] **Step 2: Document SonarQube for IDE Connected Mode**

Document extension/plugin installation, secure token creation outside the repo, binding to the BoardReadyOps SonarQube Cloud project, synchronization and the fact that PR analysis remains authoritative.

- [ ] **Step 3: Link docs and record controls**

Link the guide from `CONTRIBUTING.md` and record Semgrep/Snyk/Sonar responsibilities in the canonical security architecture document. Update dependency automation docs with label definitions and Renovate operational verification.

- [ ] **Step 4: Run docs and policy checks**

```bash
corepack pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
corepack pnpm run docs
```

Expected: PASS.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/development/security-tooling.md CONTRIBUTING.md docs/dependency-automation.md docs/security/threat-model.md
git commit -m "docs(security): document local analysis workflow"
```

---

### Task 7: GitHub labels and Renovate operational proof

**Files:**
- No source file is required unless verification results are recorded in `docs/dependency-automation.md`.

**Interfaces:**
- Produces repository labels required by Renovate/Mergify.
- Produces an operational verification record for the Renovate GitHub App.

- [ ] **Step 1: Create missing labels**

Create or update:

```text
automerge            color 0E8A16  Safe dependency update eligible for post-CI automatic merge
manual-review        color D93F0B  Update requires explicit maintainer review
breaking-change      color B60205  Major or potentially breaking dependency update
supply-chain         color 5319E7  Actions, containers, provenance, or dependency supply-chain surface
types                color 1D76DB  TypeScript declaration or type-tooling update
lockfile-maintenance color C2E0C6  Scheduled lockfile-only maintenance
```

Do not overwrite semantically stronger existing descriptions without reviewing them.

- [ ] **Step 2: Verify Renovate installation and onboarding**

Check:

- Renovate check suite exists on recent commits;
- no Dependabot version-update configuration exists;
- search for open/closed Renovate PRs, `renovate/*` branches and the Dependency Dashboard;
- if no Dashboard exists, use the Renovate App repository configuration to request an onboarding/rescan when available.

Do not use a personal access token or commit a token. If available tools cannot trigger the GitHub App, record the exact blocker and UI path in `docs/dependency-automation.md`.

- [ ] **Step 3: Record the result**

Update the docs with an exact date and one of:

- `Operational: Dependency Dashboard created and repository scan completed`; or
- `Installed but onboarding/rescan requires a repository owner to use GitHub Apps > Renovate > Configure/Rescan`.

- [ ] **Step 4: Commit verification record if changed**

```bash
git add docs/dependency-automation.md
git commit -m "docs(deps): record Renovate operational status"
```

---

### Task 8: Final verification and delivery

**Files:**
- Review all changed files.

**Interfaces:**
- Produces a reviewable pull request independent of cloud webhook issue #187.

- [ ] **Step 1: Run focused validation**

```bash
mise exec node@24.18.0 -- corepack pnpm run renovate:validate
corepack pnpm vitest run tests/unit/repository/dependency-security-automation-policy.test.ts
semgrep --validate --config .semgrep.yml
corepack pnpm run security:semgrep:test
corepack pnpm run security:semgrep
pre-commit validate-config
pre-commit run --all-files --hook-stage pre-commit
SKIP=snyk-oss pre-commit run --all-files --hook-stage pre-push
```

- [ ] **Step 2: Verify Snyk CLI behavior**

Always run:

```bash
corepack pnpm dlx snyk@1.1306.1 --version
corepack pnpm dlx snyk@1.1306.1 test --help
```

If `SNYK_TOKEN` or authenticated Snyk config exists, run `corepack pnpm run security:snyk:oss`. If authentication is unavailable, report that the command is configured and CLI-validated but a live scan could not be completed; do not fake success.

- [ ] **Step 3: Run repository verification**

```bash
corepack pnpm run lint
corepack pnpm run typecheck
DATABASE_URL=postgresql://boardreadyops@127.0.0.1:5432/boardreadyops_ci corepack pnpm run knip
corepack pnpm vitest run tests/unit/repository
corepack pnpm run docs
git diff --check
git status --short
```

- [ ] **Step 4: Review for secrets and scope**

Inspect the diff for tokens, organization identifiers that should be private, generated outputs, lockfile noise and changes unrelated to dependency/security automation.

- [ ] **Step 5: Push and open a pull request**

Push `codex/dependency-security-automation`, create a PR describing Renovate policy, local hooks, CI checks, documentation and any live Snyk/Renovate verification limitations. Monitor every required check and fix failures before merge.
