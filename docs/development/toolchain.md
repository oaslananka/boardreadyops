# Reproducible Toolchain

`toolchain.json` is the authoritative version contract for contributor and automation tooling. It aligns Node, pnpm, Python documentation packages, pre-commit, ShellCheck, Actionlint, Semgrep, Gitleaks, zizmor, OSV-Scanner, Puppeteer, and Chrome discovery.

## Ubuntu 24.04 bootstrap

A fresh Ubuntu 24.04 x64 host needs Node with Corepack, Python with the standard `subprocess` module, `venv` support, a working `pip` inside newly created virtual environments, and the standard `apt-get`/`dpkg-deb` utilities. The repository then installs everything else without `sudo`, secrets, or global package-manager changes:

```bash
corepack pnpm run toolchain:bootstrap
```

Before JavaScript dependency installation starts, bootstrap probes Python candidates deterministically. It prefers the manifest's `python.preferred` executable (for example `python3.13`), then `python3`, then `python`. Every discovered candidate is version-checked and exercised for `subprocess`, temporary virtual-environment creation, and `pip` availability. Rejected candidates are printed with the failed capability so incomplete host Python packages fail early instead of surfacing later during docs or hook installation.

Set `BOARDREADYOPS_PYTHON` to an executable path or command name to require one specific interpreter:

```bash
BOARDREADYOPS_PYTHON=/opt/python/bin/python3.13 corepack pnpm run toolchain:bootstrap
```

An explicit override is not silently replaced by another interpreter if it is incomplete. On Ubuntu/Debian, the diagnostic points to the host prerequisites (`python3`, `python3-venv`, and `python3-pip`) but bootstrap never installs privileged system packages itself. macOS and Windows diagnostics likewise name platform-appropriate installation options.

If the pinned `uv` version from `toolchain.json` is already available on the host, bootstrap uses it to create the repository virtual environment with the selected Python. Otherwise it falls back to the selected interpreter's standard `venv` module and then installs the pinned `uv` release inside the repository-local environment. A different host `uv` version is not used for environment creation.

The bootstrap keeps project executables inside the repository and reusable downloads in the current user's XDG cache:

- `node_modules/` for JavaScript dependencies;
- `.boardreadyops/toolchain/venv/` for uv, MkDocs, pre-commit, and the pinned ShellCheck binary used by Actionlint;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/pre-commit/` for reusable pinned validation hook environments;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/puppeteer/` for Puppeteer's compatible Chrome build;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/browser-runtime/` for Ubuntu Chrome shared libraries extracted without root access;
- `.boardreadyops/toolchain/bin/pnpm` as a wrapper around `corepack pnpm`.

This wrapper prevents nested package scripts from accidentally resolving a broken or unconfigured host-global pnpm shim. Because the wrapper and virtual-environment paths are derived from the active repository root, the same isolation remains in Git worktrees and nested package scripts instead of falling back to another checkout's toolchain.

Husky hooks follow the same contract: JavaScript hook commands use `corepack pnpm`, while Python validation hooks run through `node scripts/toolchain.mjs run ...` so they resolve the repository-local `pre-commit` installation. Run `corepack pnpm run toolchain:bootstrap` once in a fresh checkout before committing or pushing.

## Doctor and verification

Run the strict prerequisite check before a long validation sequence:

```bash
corepack pnpm run toolchain:doctor
corepack pnpm run verify:all
```

`verify:all` injects the repository-local toolchain environment, runs the full repository verification, environment-independent integration tests, cloud typecheck and build, workflow linting, cloud coverage, accessibility checks, and security compliance. Missing or incompatible tools—including the repo-local ShellCheck used by Actionlint—and host-inherited setgid directory modes fail in `toolchain:doctor` before the expensive stages begin. Bootstrap and toolchain-run commands normalize only that untracked mode metadata. The injected environment also provides a loopback-only placeholder `DATABASE_URL` when none is set, allowing Knip to load Prisma configuration without requiring credentials or opening a database connection. PostgreSQL integration tests additionally require `BOARDREADYOPS_POSTGRES_TESTS=true` and reject that placeholder, so local and CI runs share one explicit database-test contract. It sets `ALLOW_MAJOR_RELEASE=true` only inside the verification environment so the current stable package version can be validated without a manual prefix; this flag does not publish or release artifacts.

The generated environment file can also be sourced for interactive work:

```bash
source "$(corepack pnpm -s toolchain:env)"
```

## Browser discovery

The bootstrap asks Puppeteer 25.8.0 to install its compatible Chrome revision and records the executable in `.boardreadyops/toolchain/browser-path`. Documentation accessibility checks prefer `PA11Y_CHROME_PATH`, then this recorded path, and finally standard system Chrome or Edge locations. Doctor executes the recorded browser with `--version`, so a present but unloadable binary fails before the 194-page accessibility scan begins.

## Optional prerequisites

KiCad and PostgreSQL are intentionally outside the base toolchain:

- KiCad is required for DRC/ERC and integration scenarios that invoke `kicad-cli`.
- PostgreSQL is required for database-backed cloud integration tests.
- Nexar credentials are optional and only enable Nexar-backed lifecycle checks.

See [Testing Policy](testing-policy.md) and [Self-hosted deployment](../deployment/self-hosted.md) for those environments.

## CI compatibility and caching

The preferred Node release is pinned exactly in `.nvmrc` and workflow `NODE_VERSION` variables. Node 22 remains in compatibility matrices because `package.json` supports `^22.14.0 || ^24.0.0`. Python and validation-tool versions are checked against `toolchain.json` by unit tests.

GitHub-hosted jobs deliberately keep clean dependency installation as the authoritative gate. User-scoped pnpm, pre-commit, Puppeteer, and Next.js caches may be reused because generated bundles, clean-tree checks, and committed-dist verification still rebuild and compare outputs.
