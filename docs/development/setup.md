# Development Setup

On Ubuntu 24.04 x64, install Node with Corepack and Python with `venv` support, then run the repository-local bootstrap:

```bash
corepack pnpm run toolchain:bootstrap
corepack pnpm run toolchain:doctor
```

Run the complete contributor and automation contract with:

```bash
ALLOW_MAJOR_RELEASE=true corepack pnpm run verify:all
```

The bootstrap does not require repository secrets or `sudo` and does not install pnpm, Python packages, browsers, or validation tools globally. See [Reproducible Toolchain](toolchain.md) for paths, versions, optional KiCad/PostgreSQL prerequisites, and browser discovery.
