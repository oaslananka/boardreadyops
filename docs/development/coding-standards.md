# Coding Standards

## TypeScript style

- Use the pinned TypeScript and package manager versions from `package.json`.
- Prefer explicit domain types for public contracts.
- Keep runtime code free of unbounded process, filesystem, and network access.
- Avoid `any` unless a short justification is included nearby.
- Keep user-facing strings stable when tests or docs rely on them.

## Layer boundaries

Run this after import or module layout changes:

```bash
corepack pnpm run verify:structure
```

Do not bypass the architecture boundary check by moving shared behavior into the
wrong layer. Add or update an ADR when the layer model needs to change.

## Generated outputs

Do not edit generated bundles or docs by hand. Regenerate them through scripts:

```bash
corepack pnpm run build
corepack pnpm run docs
corepack pnpm run verify:dist
```

## Error handling

- Return structured findings for user-facing validation failures.
- Use explicit non-zero exit codes for CLI command failure modes.
- Do not call `process.exit()` from library code.
- Redact secrets in logs and errors.
