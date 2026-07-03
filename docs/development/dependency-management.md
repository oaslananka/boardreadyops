# Dependency Management

## Package manager

Use the package manager pinned in `package.json`. Do not switch package managers
or regenerate the lockfile with a different tool.

```bash
corepack pnpm install --frozen-lockfile
```

## Update policy

- Prefer automated dependency update pull requests.
- Keep updates scoped and review release notes for major versions.
- Run `corepack pnpm run security` after dependency changes.
- Refresh `NOTICE` with `corepack pnpm run notice` when lockfile dependencies
  change.
- Run `corepack pnpm run verify:dist` after dependency changes that can affect
  bundled output.

## Security checks

The expected checks are:

```bash
corepack pnpm audit --audit-level moderate
corepack pnpm run licenses:check
corepack pnpm run notice:check
corepack pnpm run check:reuse
```

The repository also runs OSV, dependency review, CodeQL, gitleaks, and Trivy in
GitHub Actions where applicable.

## License and NOTICE

Do not merge dependency updates when license or NOTICE checks are stale. Update
`NOTICE` in the same PR as dependency updates unless a release manager explicitly
separates the change.
