# Tooling

`toolchain.json` is the canonical contributor and automation version manifest. `scripts/toolchain.mjs` bootstraps and validates a repository-local environment so local work, VPS automation, and CI use the same declared tools without relying on host-global shims.

The toolchain includes:

- Node 24.19.0 as the preferred runtime, with Node 22.14+ retained in compatibility testing;
- pnpm 11.8.0 through Corepack and a repository-local nested-script wrapper;
- TypeScript, Biome, Vitest, V8 coverage, esbuild, and Puppeteer from the lockfile;
- uv 0.11.16 and uv 0.11.16 and MkDocs Material in a repository-local Python virtual environment;
- pre-commit-managed Actionlint, Semgrep, Gitleaks, zizmor, and OSV-Scanner environments;
- Puppeteer's compatible Chrome build for deterministic documentation accessibility checks;
- release-please for release pull request management through a pinned GitHub Action.

Use `corepack pnpm run toolchain:bootstrap`, then `corepack pnpm run toolchain:doctor` before `corepack pnpm run verify:all`. The full command includes repository verification, cloud checks, workflow linting, accessibility, and security compliance.

SBOM generation remains implemented locally in `scripts/generate-sbom.mjs`, so the release gate does not inherit deprecated transitive packages from external SBOM CLIs. The SARIF emitter remains implemented in `src/report/sarif.ts`; its JSON shape is covered by report tests.
