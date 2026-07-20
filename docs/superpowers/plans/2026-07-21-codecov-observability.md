# Codecov Observability Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Codecov Test Analytics, production Next.js bundle analysis, component reporting, and repository YAML validation without duplicating the test suite or replacing local quality gates.

**Architecture:** The existing `coverage-gate` job remains the single source of LCOV and gains JUnit output plus a second Codecov upload. The web production build conditionally installs the official Codecov Next.js Webpack plugin only in GitHub Actions. `codecov.yml` supplies advisory bundle and component views while local Vitest thresholds and bundle-size budgets remain blocking.

**Tech Stack:** GitHub Actions, Codecov Action v7 pinned at `fb8b3582c8e4def4969c97caa2f19720cb33a72f`, Vitest 4 JUnit reporter, Next.js 16 Webpack, `@codecov/nextjs-webpack-plugin@2.0.1`, `js-yaml`.

## Global Constraints

- Do not add another test execution solely for Codecov.
- Keep Codecov upload failures non-blocking; local coverage and bundle-size checks remain authoritative.
- Do not require a new secret for public or fork pull requests.
- Keep all GitHub Actions pinned to immutable commit SHAs.
- Enable bundle analysis only when `GITHUB_ACTIONS === "true"`.
- Use bundle name `boardreadyops-web`, informational status, and a `5%` warning threshold.
- Remove the unused `integration` coverage flag.
- Do not add component-level required status checks.

---

### Task 1: Lock the Codecov workflow and YAML contract with failing tests

**Files:**
- Create: `tests/unit/scripts/codecov-integration.test.ts`
- Read: `.github/workflows/ci.yml`
- Read: `codecov.yml`
- Read: `package.json`
- Read: `apps/web/next.config.mjs`

**Interfaces:**
- Consumes: repository files as UTF-8 text and `js-yaml`'s `load()`.
- Produces: regression assertions that later tasks must satisfy.

- [ ] **Step 1: Write the failing repository contract test**

```ts
import { readFile } from "node:fs/promises";
import { load } from "js-yaml";
import { describe, expect, it } from "vitest";

async function text(path: string): Promise<string> {
  return await readFile(path, "utf8");
}

describe("Codecov integration", () => {
  it("generates and uploads LCOV plus JUnit results from one coverage run", async () => {
    const packageJson = JSON.parse(await text("package.json")) as { scripts?: Record<string, string> };
    const workflow = await text(".github/workflows/ci.yml");

    expect(packageJson.scripts?.["coverage:ci"]).toContain("--reporter=junit");
    expect(packageJson.scripts?.["coverage:ci"]).toContain(
      "--outputFile.junit=coverage/test-results.junit.xml",
    );
    expect(workflow).toContain("run: pnpm run coverage:ci");
    expect(workflow.match(/codecov\/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f/gu)).toHaveLength(2);
    expect(workflow).toContain("report_type: test_results");
    expect(workflow).toContain("files: coverage/test-results.junit.xml");
    expect(workflow.match(/if: \$\{\{ !cancelled\(\) \}\}/gu)?.length).toBeGreaterThanOrEqual(2);
  });

  it("defines components and advisory bundle analysis without an unused integration flag", async () => {
    const config = load(await text("codecov.yml")) as Record<string, unknown>;
    const serialized = JSON.stringify(config);

    expect(serialized).toContain("component_management");
    expect(serialized).toContain("core_engine");
    expect(serialized).toContain("reporting_notifications");
    expect(serialized).toContain("bundle_analysis");
    expect(serialized).toContain("informational");
    expect(serialized).not.toContain('"integration"');
  });

  it("configures bundle analysis only for GitHub Actions builds", async () => {
    const nextConfig = await text("apps/web/next.config.mjs");
    expect(nextConfig).toContain("@codecov/nextjs-webpack-plugin");
    expect(nextConfig).toContain('process.env.GITHUB_ACTIONS === "true"');
    expect(nextConfig).toContain('bundleName: "boardreadyops-web"');
    expect(nextConfig).toContain('gitService: "github"');
    expect(nextConfig).toContain("telemetry: false");
  });
});
```

- [ ] **Step 2: Run the test and verify it fails for the missing integration**

Run:

```bash
pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts
```

Expected: FAIL because `coverage:ci`, JUnit upload, bundle plugin, component configuration, and bundle policy do not exist yet.

- [ ] **Step 3: Commit the red test**

```bash
git add tests/unit/scripts/codecov-integration.test.ts
git commit -m "test(ci): define Codecov observability contract"
```

---

### Task 2: Produce JUnit results and upload Test Analytics from the coverage job

**Files:**
- Modify: `package.json`
- Modify: `.github/workflows/ci.yml:391-427`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces: `coverage/lcov.info` and `coverage/test-results.junit.xml` from one command.
- Produces: two uploads through the pinned Codecov Action, one coverage and one `test_results`.

- [ ] **Step 1: Add the CI-only coverage command**

Add this script next to `coverage` in `package.json`:

```json
"coverage:ci": "pnpm run build && vitest run --coverage --reporter=default --reporter=github-actions --reporter=junit --outputFile.junit=coverage/test-results.junit.xml tests/unit tests/action tests/property tests/snapshot"
```

Keep the existing `coverage` command unchanged for local and release verification.

- [ ] **Step 2: Update the coverage job**

Replace the current coverage execution and upload section with:

```yaml
      - run: pnpm run coverage:ci
      - name: Upload coverage report
        uses: actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a
        if: always()
        with:
          name: coverage-report
          path: coverage/
          if-no-files-found: warn
      - name: Validate Codecov configuration
        if: ${{ !cancelled() }}
        run: >-
          curl --fail-with-body --silent --show-error
          --retry 3 --retry-all-errors
          --data-binary @codecov.yml
          https://api.codecov.io/validate
      - name: Upload coverage to Codecov
        if: ${{ !cancelled() }}
        uses: codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f
        with:
          disable_search: true
          files: coverage/lcov.info
          fail_ci_if_error: false
          flags: unit
          name: boardreadyops-unit-coverage
      - name: Upload test results to Codecov
        if: ${{ !cancelled() }}
        uses: codecov/codecov-action@fb8b3582c8e4def4969c97caa2f19720cb33a72f
        with:
          disable_search: true
          files: coverage/test-results.junit.xml
          fail_ci_if_error: false
          flags: unit
          name: boardreadyops-unit-tests
          report_type: test_results
```

- [ ] **Step 3: Run the focused contract test**

Run:

```bash
pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts
```

Expected: the coverage/Test Analytics test passes; bundle and YAML tests remain failing.

- [ ] **Step 4: Generate a real JUnit file locally**

Run:

```bash
pnpm run coverage:ci
```

Expected:
- command exits 0;
- `coverage/lcov.info` exists;
- `coverage/test-results.junit.xml` starts with `<?xml` and contains `<testsuites`;
- local Vitest coverage thresholds pass.

- [ ] **Step 5: Commit the coverage and Test Analytics integration**

```bash
git add package.json .github/workflows/ci.yml tests/unit/scripts/codecov-integration.test.ts
git commit -m "feat(ci): upload Codecov test analytics"
```

---

### Task 3: Add production Next.js bundle analysis

**Files:**
- Modify: `apps/web/package.json`
- Modify: `apps/web/next.config.mjs`
- Modify: `pnpm-lock.yaml`
- Modify: `.github/workflows/ci.yml:349-374`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Consumes: `GITHUB_ACTIONS`, optional `CODECOV_TOKEN`, and Next.js's `options.webpack` object.
- Produces: Codecov bundle reports named `boardreadyops-web` only from GitHub Actions production builds.

- [ ] **Step 1: Install the pinned official plugin**

Run:

```bash
pnpm --filter @boardreadyops/web add -D @codecov/nextjs-webpack-plugin@2.0.1
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` change; no unrelated package updates occur.

- [ ] **Step 2: Configure the plugin at the end of the Next.js Webpack plugin list**

Change `apps/web/next.config.mjs` to:

```js
import { codecovNextJSWebpackPlugin } from "@codecov/nextjs-webpack-plugin";

const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  transpilePackages: [
    "@boardreadyops/cloud-core",
    "@boardreadyops/contracts",
    "@boardreadyops/db",
    "@octokit/auth-app",
  ],
  webpack(config, options) {
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      ".js": [".js", ".ts", ".tsx"],
    };

    if (process.env.GITHUB_ACTIONS === "true") {
      config.plugins.push(
        codecovNextJSWebpackPlugin({
          enableBundleAnalysis: true,
          bundleName: "boardreadyops-web",
          uploadToken: process.env.CODECOV_TOKEN,
          gitService: "github",
          telemetry: false,
          webpack: options.webpack,
        }),
      );
    }

    return config;
  },
};

export default nextConfig;
```

- [ ] **Step 3: Expose the optional token only to the production web build**

Replace the cloud build step with:

```yaml
      - name: Build cloud application
        env:
          CODECOV_TOKEN: ${{ secrets.CODECOV_TOKEN }}
        run: pnpm run cloud:build
```

Do not add workflow-level `id-token: write`; public and fork builds use the plugin's GitHub tokenless behavior when no token is available.

- [ ] **Step 4: Run focused tests and local build isolation**

Run:

```bash
pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts
pnpm run cloud:typecheck
pnpm run cloud:build
```

Expected:
- focused test passes its bundle assertions;
- local build exits 0 without attempting a Codecov upload because `GITHUB_ACTIONS` is not `true`;
- standalone runtime smoke passes.

- [ ] **Step 5: Commit bundle analysis**

```bash
git add apps/web/package.json apps/web/next.config.mjs pnpm-lock.yaml .github/workflows/ci.yml tests/unit/scripts/codecov-integration.test.ts
git commit -m "feat(ci): add Codecov bundle analysis"
```

---

### Task 4: Configure Codecov components and advisory bundle policy

**Files:**
- Modify: `codecov.yml`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces: component views from the existing single `unit` coverage upload.
- Produces: informational bundle-change status with a 5% warning threshold.

- [ ] **Step 1: Replace the unused flag and add components**

Use this complete `codecov.yml`:

```yaml
comment:
  behavior: default
  layout: header, reach, diff, flags, components, footer
  require_changes: false
  show_carryforward_flags: true
  require_base: false

coverage:
  precision: 2
  round: down
  range: 70..100
  status:
    project:
      default:
        target: 90%
        threshold: 2%
        flags:
          - unit
    patch:
      default:
        target: 90%
        flags:
          - unit
    changes: false

flags:
  unit:
    paths:
      - src/
    carryforward: true

component_management:
  individual_components:
    - component_id: core_engine
      name: Core engine
      paths:
        - src/core/**
    - component_id: rules
      name: Rules
      paths:
        - src/rules/**
    - component_id: bom_supply_chain
      name: BOM and supply chain
      paths:
        - src/bom/**
    - component_id: pinmap_contracts
      name: Pinmap contracts
      paths:
        - src/pinmap/**
    - component_id: kicad_integration
      name: KiCad integration
      paths:
        - src/kicad/**
    - component_id: reporting_notifications
      name: Reporting and notifications
      paths:
        - src/report/**
        - src/notifiers/**
    - component_id: action_inputs
      name: GitHub Action inputs
      paths:
        - src/action/inputs.ts

bundle_analysis:
  warning_threshold: "5%"
  status: informational

ignore:
  - "dist/**/*"
```

- [ ] **Step 2: Run the local contract test**

Run:

```bash
pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts
```

Expected: all Codecov integration tests pass.

- [ ] **Step 3: Validate against Codecov's official endpoint**

Run:

```bash
curl --fail-with-body --silent --show-error \
  --retry 3 --retry-all-errors \
  --data-binary @codecov.yml \
  https://api.codecov.io/validate
```

Expected: HTTP 200 and a valid configuration response.

- [ ] **Step 4: Commit repository configuration**

```bash
git add codecov.yml tests/unit/scripts/codecov-integration.test.ts
git commit -m "feat(ci): configure Codecov components"
```

---

### Task 5: Document and verify the complete integration

**Files:**
- Create: `docs/integrations/codecov.md`
- Modify: `mkdocs.yml:145-151`
- Test: `tests/unit/scripts/codecov-integration.test.ts`

**Interfaces:**
- Produces: operator documentation for coverage, Test Analytics, bundle analysis, authentication, and troubleshooting.

- [ ] **Step 1: Write the integration guide**

Create `docs/integrations/codecov.md` with these sections and exact operational facts:

```markdown
# Codecov

BoardReadyOps uses Codecov as an advisory view over repository-owned quality gates.

## Authoritative local gates

- Vitest coverage thresholds in `vitest.config.ts`
- bundle budgets from `pnpm run check:size`
- repository CI and security workflows

Codecov upload failures do not override these local gates.

## Coverage and Test Analytics

`pnpm run coverage:ci` emits:

- `coverage/lcov.info`
- `coverage/test-results.junit.xml`

The `ci / coverage-gate` job uploads both files through the pinned Codecov Action. Upload steps use `if: ${{ !cancelled() }}` so failed tests remain visible in Test Analytics.

## Bundle analysis

The Next.js Webpack plugin runs only when `GITHUB_ACTIONS=true`. The bundle name is `boardreadyops-web`. Internal builds may use `CODECOV_TOKEN`; public and fork pull requests can use Codecov's GitHub tokenless behavior.

Bundle status is informational with a 5% warning threshold. The local bundle-size budget remains blocking.

## Components

The repository YAML exposes core, rules, BOM, pinmap, KiCad, reporting, and Action-input components without creating additional required checks.

## Validation

Validate changes with:

```bash
curl --fail-with-body --silent --show-error \
  --data-binary @codecov.yml \
  https://api.codecov.io/validate
```
```

- [ ] **Step 2: Add the guide to MkDocs navigation**

Under `Reference > Integrations`, add:

```yaml
          - Codecov: integrations/codecov.md
```

- [ ] **Step 3: Run targeted and repository-wide verification**

Run:

```bash
pnpm exec vitest run tests/unit/scripts/codecov-integration.test.ts
pnpm run lint
pnpm run typecheck
pnpm run knip
pnpm run verify:structure
pnpm run gc
pnpm run cloud:typecheck
pnpm run cloud:build
pnpm run verify:dist
pnpm run docs
pnpm run security
```

Expected: all commands exit 0. Existing non-blocking warnings may remain, but no new errors are introduced.

- [ ] **Step 4: Run the full unit and CI coverage suites**

Run:

```bash
pnpm run test:unit
pnpm run coverage:ci
```

Expected: all unit tests pass, coverage thresholds pass, and both Codecov files are generated.

- [ ] **Step 5: Commit documentation**

```bash
git add docs/integrations/codecov.md mkdocs.yml
git commit -m "docs(ci): document Codecov integration"
```

- [ ] **Step 6: Push and open the pull request**

```bash
git push -u origin feat/codecov-observability
```

Create a PR titled `feat(ci): expand Codecov observability` with the design, verification commands, and official Codecov documentation references. Inspect all bot and agent comments, resolve actionable findings, rerun failed checks, and merge only when required checks are green and review threads are resolved.
