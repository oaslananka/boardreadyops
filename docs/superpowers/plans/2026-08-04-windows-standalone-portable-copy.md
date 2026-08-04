# Windows Standalone Portable Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the isolated Next.js standalone runtime work on Windows by preserving directory symlink types during portable copies and continuously verifying the behavior in CI.

**Architecture:** `copyDirectoryPortable` will preserve the stored symlink target and derive the destination symlink type from the resolved source target. A focused cross-platform unit test will reproduce the pnpm-style relative directory link, while a dedicated Windows CI job will build and smoke-test the standalone runtime.

**Tech Stack:** Node.js 24.18.0, TypeScript, Vitest, pnpm 11.8.0, GitHub Actions, Windows Server 2025 runner.

## Global Constraints

- Preserve relative symlink target strings exactly.
- Retain `dereferenceSymlinks: true` behavior.
- Do not special-case Next.js package names.
- Do not add dependencies or generated outputs.
- Run the regression test on Windows, Linux, and macOS.
- Follow red-green-refactor and commit each independently reviewable task.

---

### Task 1: Preserve directory symlink types

**Files:**
- Modify: `tests/unit/scripts/portable-copy.test.ts`
- Modify: `scripts/lib/portable-copy.mjs`

**Interfaces:**
- Consumes: `copyDirectoryPortable(source, destination, options?)`
- Produces: copied file and directory symlinks whose relative targets remain usable.

- [ ] **Step 1: Write the failing directory-symlink test**

Add a test that creates `node_modules/next` as a relative directory symlink to `.pnpm/next/node_modules/next`, copies the source tree, and reads `package.json` through the copied link.

```ts
it("preserves relative directory symlinks", async () => {
  const source = await mkdtemp(path.join(process.cwd(), ".portable-copy-directory-source-"));
  temporaryRoots.push(source);
  const packageRoot = path.join(source, "node_modules", ".pnpm", "next", "node_modules", "next");
  await mkdir(packageRoot, { recursive: true });
  await writeFile(path.join(packageRoot, "package.json"), '{"name":"next"}\n');
  const target = path.join(".pnpm", "next", "node_modules", "next");
  await symlink(target, path.join(source, "node_modules", "next"), "dir");

  const destinationParent = await mkdtemp(path.join(os.tmpdir(), "boardreadyops-portable-copy-"));
  temporaryRoots.push(destinationParent);
  const destination = path.join(destinationParent, "runtime");
  await copyDirectoryPortable(source, destination);

  await expect(readlink(path.join(destination, "node_modules", "next"))).resolves.toBe(target);
  await expect(readFile(path.join(destination, "node_modules", "next", "package.json"), "utf8")).resolves.toBe(
    '{"name":"next"}\n',
  );
});
```

- [ ] **Step 2: Run the focused test and verify RED**

Run: `corepack pnpm exec vitest run tests/unit/scripts/portable-copy.test.ts`
Expected on Windows: FAIL while reading through the copied link because the destination link was created as a file symlink.

- [ ] **Step 3: Implement the minimal symlink-type fix**

In `scripts/lib/portable-copy.mjs`, import `stat` and `resolve`. For a non-dereferenced symlink, read its target, resolve it from the source link directory, inspect the target, and pass `"dir"` or `"file"` to `symlink`.

```js
const target = await readlink(source);
const targetMetadata = await stat(resolve(dirname(source), target));
await mkdir(dirname(destination), { recursive: true });
await symlink(target, destination, targetMetadata.isDirectory() ? "dir" : "file");
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run: `corepack pnpm exec vitest run tests/unit/scripts/portable-copy.test.ts`
Expected: both portable-copy tests pass, with the Unix setgid test skipped only on Windows.

- [ ] **Step 5: Run type and style checks for touched files**

Run: `corepack pnpm exec biome check scripts/lib/portable-copy.mjs tests/unit/scripts/portable-copy.test.ts`
Expected: exit code 0 with no diagnostics.

- [ ] **Step 6: Commit Task 1**

```powershell
git add scripts/lib/portable-copy.mjs tests/unit/scripts/portable-copy.test.ts
git commit -m "fix(web): preserve directory symlinks in portable copies"
```

### Task 2: Add Windows standalone CI coverage

**Files:**
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Consumes: `needs_build` and `needs_integration` outputs from `risk-profile`.
- Produces: required job `ci / web-standalone-windows` on the Windows Server 2025 runner.

- [ ] **Step 1: Add the dedicated Windows job**

Insert a job after the existing Linux `build` job. It checks out without persisted credentials, installs the pinned Node and pnpm toolchain, installs the frozen workspace, builds repository packages and the web app, then runs the isolated standalone smoke test.

```yaml
  web-standalone-windows:
    needs: risk-profile
    if: >-
      (github.repository_owner == 'oaslananka' || github.repository_owner == 'oaslananka-ops') &&
      (needs.risk-profile.outputs.needs_build == 'true' || needs.risk-profile.outputs.needs_integration == 'true')
    name: ci / web-standalone-windows
    runs-on: windows-2025-vs2026
    timeout-minutes: 20
    steps:
      - uses: actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0
        with:
          persist-credentials: false
      - uses: actions/setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e
        with:
          node-version: ${{ env.NODE_VERSION }}
          package-manager-cache: false
      - run: corepack enable
      - run: corepack install
      - run: pnpm install --frozen-lockfile
      - run: pnpm run build
      - run: pnpm --filter @boardreadyops/web build
      - run: pnpm run verify:web-standalone
```

- [ ] **Step 2: Validate workflow syntax and security policy**

Run: `corepack pnpm run workflow:lint`
Expected: actionlint and zizmor exit with code 0.

- [ ] **Step 3: Validate risk-profile routing**

Run a temporary changed-files list containing `scripts/lib/portable-copy.mjs`, `tests/unit/scripts/portable-copy.test.ts`, and `.github/workflows/ci.yml`; execute `node scripts/ci-risk-profile.mjs <file>`.
Expected: `needs_build=true`, `needs_integration=true`, and `needs_unit_matrix=true`.

- [ ] **Step 4: Commit Task 2**

```powershell
git add .github/workflows/ci.yml
git commit -m "ci: verify web standalone runtime on Windows"
```

### Task 3: Verify the complete change

**Files:**
- Verify only; no planned source modifications.

**Interfaces:**
- Consumes: the portable-copy fix and Windows CI workflow.
- Produces: fresh evidence that the original Windows failure and repository regressions are resolved.

- [ ] **Step 1: Build the web application**

Run: `corepack pnpm --filter @boardreadyops/web build`
Expected: Next.js production build exits with code 0.

- [ ] **Step 2: Run the original standalone smoke test**

Run: `corepack pnpm run verify:web-standalone`
Expected: output includes `Web standalone runtime smoke passed.` and exits with code 0.

- [ ] **Step 3: Run broader repository checks**

Run in order:

```powershell
corepack pnpm run typecheck
corepack pnpm run lint
corepack pnpm run test:unit
```

Expected: all commands exit with code 0; existing lint warnings may remain but no new diagnostics may be introduced.

- [ ] **Step 4: Inspect the final diff and tree**

Run:

```powershell
git diff main...HEAD --check
git status --short
git log --oneline main..HEAD
```

Expected: no whitespace errors, no untracked build output, and only the design, plan, portable-copy fix, regression test, and CI workflow commits.

- [ ] **Step 5: Commit any plan checkbox updates only if needed**

Do not commit generated build output. Keep the branch ready for review or PR creation.
