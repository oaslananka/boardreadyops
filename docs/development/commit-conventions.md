# Commit Conventions

BoardReadyOps uses Conventional Commits.

## Format

```text
type(scope): short imperative summary
```

Examples:

```text
fix(cli): preserve exit code for missing config
feat(report): add release readiness summary
chore(deps): update test tooling
```

## Common types

- `feat`: user-visible feature.
- `fix`: bug fix.
- `docs`: documentation-only change.
- `test`: test-only change.
- `refactor`: behavior-preserving code restructuring.
- `chore`: maintenance that does not affect runtime behavior.
- `ci`: workflow or automation change.
- `build`: bundling, packaging, or generated distribution change.

## Pull request expectations

Each PR should be scoped, linked to an issue when possible, and include validation
commands. Sensitive surfaces require maintainer review even when CI passes.
