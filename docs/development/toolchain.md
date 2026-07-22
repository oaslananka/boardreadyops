# Reproducible Toolchain

`toolchain.json` is the authoritative version contract for contributor and automation tooling. It aligns Node, pnpm, Python documentation packages, pre-commit, Actionlint, Semgrep, Gitleaks, zizmor, OSV-Scanner, Puppeteer, and Chrome discovery.

## Ubuntu 24.04 bootstrap

A fresh Ubuntu 24.04 x64 host needs Node with Corepack and Python with `venv` support. The repository then installs everything else without `sudo`, secrets, or global package-manager changes:

```bash
corepack pnpm run toolchain:bootstrap
```

The bootstrap writes only to these repository-local locations:

- `node_modules/` for JavaScript dependencies;
- `.boardreadyops/toolchain/venv/` for MkDocs and pre-commit;
- `.boardreadyops/toolchain/cache/pre-commit/` for pinned validation hook environments;
- `.boardreadyops/toolchain/cache/puppeteer/` for Puppeteer's compatible Chrome build;
- `.boardreadyops/toolchain/bin/pnpm` as a wrapper around `corepack pnpm`.

This wrapper prevents nested package scripts from accidentally resolving a broken or unconfigured host-global pnpm shim.

## Doctor and verification

Run the strict prerequisite check before a long validation sequence:

```bash
corepack pnpm run toolchain:doctor
corepack pnpm run verify:all
```

`verify:all` injects the repository-local toolchain environment, runs the full repository verification, cloud typecheck and build, workflow linting, accessibility checks, and security compliance. Missing or incompatible tools fail in `toolchain:doctor` before the expensive stages begin.

The generated environment file can also be sourced for interactive work:

```bash
source "$(corepack pnpm -s toolchain:env)"
```

## Browser discovery

The bootstrap asks Puppeteer 25.2.0 to install its compatible Chrome revision and records the executable in `.boardreadyops/toolchain/browser-path`. Documentation accessibility checks prefer `PA11Y_CHROME_PATH`, then this recorded path, and finally standard system Chrome or Edge locations.

## Optional prerequisites

KiCad and PostgreSQL are intentionally outside the base toolchain:

- KiCad is required for DRC/ERC and integration scenarios that invoke `kicad-cli`.
- PostgreSQL is required for database-backed cloud integration tests.
- Nexar credentials are optional and only enable Nexar-backed lifecycle checks.

See [Testing Policy](testing-policy.md) and [Self-hosted deployment](../deployment/self-hosted.md) for those environments.

## CI compatibility and caching

The preferred Node release is pinned exactly in `.nvmrc` and workflow `NODE_VERSION` variables. Node 22 remains in compatibility matrices because `package.json` supports `^22.14.0 || ^24.0.0`. Python and validation-tool versions are checked against `toolchain.json` by unit tests.

GitHub-hosted jobs deliberately keep clean dependency installation as the authoritative gate. Local pnpm, pre-commit, Puppeteer, and Next.js caches may be reused because generated bundles, clean-tree checks, and committed-dist verification still rebuild and compare outputs.
