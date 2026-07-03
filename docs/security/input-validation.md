# Input Validation

BoardReadyOps consumes untrusted project files and workflow inputs. Input
validation should be deterministic, bounded, and safe by default.

## Input classes

| Input | Parser / control | Required behavior |
| --- | --- | --- |
| CLI paths | `normalizePathInput`, path helpers | Normalize and avoid path traversal. |
| GitHub Action paths | `src/action/inputs.ts` | Stay inside `GITHUB_WORKSPACE`. |
| YAML config | AJV schema and YAML loader | Reject invalid config with actionable errors. |
| KiCad project files | KiCad parser helpers | Tolerate malformed input and report findings/errors. |
| BOM/pinmap files | BOM and pinmap loaders | Normalize columns/keys and emit stable findings. |
| Notifier configuration | Environment variable lookup | Do not print sensitive values. |
| Plugin packages | Plugin schema and permission model | Validate metadata; runtime sandbox still missing. |

## Validation rules

- Validate public configuration through JSON Schema.
- Treat repository-controlled input as untrusted, especially in PRs.
- Bound process output and execution time for external commands.
- Prefer structured findings over thrown exceptions for user-correctable input.
- Redact sensitive identifiers, authorization data, and service credentials.
- Add property tests for parser normalization and path handling.

## Review triggers

Require maintainer review when a change expands:

- Filesystem access.
- Network access.
- Process execution.
- Plugin loading.
- GitHub Action permissions.
- Release asset generation or signing.
