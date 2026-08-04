# Windows Standalone Portable Copy Design

## Context

The Next.js standalone build succeeds, but its isolated runtime smoke test fails on Windows with `Cannot find module 'next'`. The standalone tree contains relative directory symlinks under `node_modules`. `copyDirectoryPortable` recreates every symlink without specifying whether the target is a file or directory. Windows therefore creates an unusable link for directory targets after the tree is copied to the isolated runtime.

The existing portable-copy test is skipped on Windows and only covers a file symlink on Unix-like systems. The cloud build smoke test also runs only on Ubuntu, so the Windows failure is not currently caught in CI.

## Goals

- Preserve relative file and directory symlinks when copying a tree.
- Keep symlink targets contained and unchanged.
- Retain the existing `dereferenceSymlinks` behavior.
- Add regression coverage that runs on Windows.
- Exercise the standalone runtime smoke test in Windows CI.

## Non-goals

- Rewriting Next.js standalone output.
- Dereferencing every symlink by default.
- Changing application runtime behavior or deployment layout.

## Considered approaches

1. Dereference all standalone symlinks. This is simple but expands the output, can duplicate dependency trees, and changes existing copy semantics.
2. Special-case the `next` package link. This is narrow but brittle and likely to fail for another directory symlink later.
3. Detect the source symlink target type and recreate the same link type. This preserves semantics and fixes the general portable-copy abstraction.

The selected approach is option 3.

## Design

When `copyEntry` encounters a symbolic link, it will read the stored target exactly as today. It will then resolve the target relative to the source link and call `stat` on that resolved path to determine whether the target is a directory. The destination link will be created with:

- `"dir"` for directory targets on Windows-compatible filesystems;
- `"file"` for file targets;
- the unchanged relative target string, so the copied tree remains relocatable.

If the source link is dangling, the copy will fail with the underlying filesystem error rather than guessing a link type. This matches the current fail-fast behavior for unsupported or unreadable entries.

The dereference path remains unchanged: `realpath` resolves the target and the target contents are copied recursively.

## Tests

A new cross-platform regression test will create a source tree containing a relative directory symlink such as `node_modules/next -> .pnpm/next/node_modules/next`, copy it, and verify:

- the copied link remains a symbolic link;
- `readlink` returns the same relative target;
- reading a file through the copied link succeeds.

The existing Unix permission-bit test remains Unix-only because its setgid premise is not meaningful on Windows. The new directory-link test will run on Windows, Linux, and macOS.

The implementation will follow test-driven development: add the Windows-reproducing test first, confirm failure, apply the minimal copy fix, and rerun focused and broader tests.

## CI

The Windows unit-test matrix will catch the portable-copy regression. A dedicated `ci / web-standalone-windows` job will also be added to `.github/workflows/ci.yml`. It will use the existing `windows-2025-vs2026` runner, follow the same risk-profile build gate, install the frozen workspace, build only `@boardreadyops/web`, and run `pnpm run verify:web-standalone`. Keeping this separate from the unit matrix avoids rebuilding the web application in every Node/OS test lane.

## Acceptance criteria

- The new directory-symlink regression test fails on the current implementation and passes after the fix.
- `pnpm --filter @boardreadyops/web build` completes on AMD2700X.
- `pnpm run verify:web-standalone` passes from an isolated Windows runtime.
- Existing portable-copy, unit, typecheck, lint, and cloud build checks remain green.
- No generated output or unrelated source file changes are included.
