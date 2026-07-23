# Reproducible Toolchain

`toolchain.json` is the authoritative version contract for contributor and automation tooling. It aligns Node, pnpm, Python documentation packages, pre-commit, Actionlint, Semgrep, Gitleaks, zizmor, OSV-Scanner, Puppeteer, and Chrome discovery.

## Ubuntu 24.04 bootstrap

A fresh Ubuntu 24.04 x64 host needs Node with Corepack, Python with `venv` support, and the standard `apt-get`/`dpkg-deb` utilities. The repository then installs everything else without `sudo`, secrets, or global package-manager changes:

```bash
corepack pnpm run toolchain:bootstrap
```

The bootstrap keeps project executables inside the repository and reusable downloads in the current user's XDG cache:

- `node_modules/` for JavaScript dependencies;
- `.boardreadyops/toolchain/venv/` for uv, MkDocs, and pre-commit;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/pre-commit/` for reusable pinned validation hook environments;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/puppeteer/` for Puppeteer's compatible Chrome build;
- `${XDG_CACHE_HOME:-~/.cache}/boardreadyops/toolchain-v1/browser-runtime/` for Ubuntu Chrome shared libraries extracted without root access;
- `.boardreadyops/toolchain/bin/pnpm` as a wrapper around `corepack pnpm`.

This wrapper prevents nested package scripts from accidentally resolving a broken or unconfigured host-global pnpm shim.

## Doctor and verification

Run the strict prerequisite check before a long validation sequence:

```bash
corepack pnpm run toolchain:doctor
corepack pnpm run verify:all
```

`verify:all` injects the repository-local toolchain environment, runs the full repository verification, environment-independent integration tests, cloud typecheck and build, workflow linting, cloud coverage, accessibility checks, and security compliance. Missing or incompatible tools and host-inherited setgid directory modes fail in `toolchain:doctor` before the expensive stages begin. Bootstrap and toolchain-run commands normalize only that untracked mode metadata. The injected environment also provides a loopback-only placeholder `DATABASE_URL` when none is set, allowing Knip to load Prisma configuration without requiring credentials or opening a database connection. PostgreSQL integration tests additionally require `BOARDREADYOPS_POSTGRES_TESTS=true` and reject that placeholder, so local and CI runs share one explicit database-test contract. It sets `ALLOW_MAJOR_RELEASE=true` only inside the verification environment so the current stable package version can be validated without a manual prefix; this flag does not publish or release artifacts.

The generated environment file can also be sourced for interactive work:

```bash
source "$(corepack pnpm -s toolchain:env)"
```

## Browser discovery

The bootstrap asks Puppeteer 25.2.0 to install its compatible Chrome revision and records the executable in `.boardreadyops/toolchain/browser-path`. Documentation accessibility checks prefer `PA11Y_CHROME_PATH`, then this recorded path, and finally standard system Chrome or Edge locations. Doctor executes the recorded browser with `--version`, so a present but unloadable binary fails before the 194-page accessibility scan begins.

## Optional prerequisites

KiCad and PostgreSQL are intentionally outside the base toolchain:

- KiCad is required for DRC/ERC and integration scenarios that invoke `kicad-cli`.
- PostgreSQL is required for database-backed cloud integration tests.
- Nexar credentials are optional and only enable Nexar-backed lifecycle checks.

See [Testing Policy](testing-policy.md) and [Self-hosted deployment](../deployment/self-hosted.md) for those environments.

## CI compatibility and caching

The preferred Node release is pinned exactly in `.nvmrc` and workflow `NODE_VERSION` variables. Node 22 remains in compatibility matrices because `package.json` supports `^22.14.0 || ^24.0.0`. Python and validation-tool versions are checked against `toolchain.json` by unit tests.

GitHub-hosted jobs deliberately keep clean dependency installation as the authoritative gate. User-scoped pnpm, pre-commit, Puppeteer, and Next.js caches may be reused because generated bundles, clean-tree checks, and committed-dist verification still rebuild and compare outputs.
