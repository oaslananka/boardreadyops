# Support

BoardReadyOps is maintained as a public open-source project. Support is provided
through public GitHub channels unless the report involves a private vulnerability
or sensitive operational detail.

## Supported channels

| Need | Channel | Expected handling |
| --- | --- | --- |
| Bug report | GitHub issue using the bug template | Triaged by severity and reproducibility. |
| Feature request | GitHub issue using the feature template | Reviewed against roadmap and maintainer capacity. |
| Security vulnerability | GitHub private vulnerability reporting or the process in `SECURITY.md` | Handled privately until disclosure is safe. |
| Usage question | GitHub issue or discussion if discussions are enabled | Best-effort community/maintainer response. |
| Release/package problem | GitHub issue with version, platform, install method, and checksum details | Prioritized when it blocks installation or CI usage. |

## Before opening an issue

1. Check the README, docs site, `docs/support-matrix.md`, and existing issues.
2. Run `boardreadyops doctor --format json` when the CLI is available.
3. Include the exact package version, Node.js version, KiCad CLI version when
   relevant, operating system, and the command that failed.
4. Redact repository secrets, tokens, private board data, and supplier credentials.

## Support scope

Maintainers can help with BoardReadyOps behavior, documented workflows, release
artifacts, schema compatibility, and reproducible bugs. Maintainers cannot review
private PCB designs, certify manufacturer output, or provide guaranteed hardware
manufacturing advice through public issues.

## Service expectations

This project currently has a solo maintainer. Response times are best effort, not
a commercial service-level agreement. Security and release integrity issues are
prioritized over general usage questions.
