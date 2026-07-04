# Test hardening areas

This page tracks fragile areas that require focused regression tests before release quality work can be considered complete.

## Current focus

- Release diff ordering and truncation behavior.
- Package content validation.
- Release asset preparation.
- Vendor profile scoring.
- BOM parsing edge cases.
- Pin map parsing edge cases.
- Firmware contract checks.
- Review comment rendering.
- Notification fallback behavior.

## Acceptance rule

A fragile area is considered covered only when it has focused tests, clear fixtures, and a passing CI run on the pull request that introduces the coverage.
