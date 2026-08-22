# Review app (prototype)

The review app is an app-style pull request review experience for release checks. Instead of the full Markdown report, BoardReadyOps posts a compact, sticky review comment: a single release decision, a severity breakdown, the top findings grouped by severity, and links to the full reports. It is part of the [BoardReadyOps v2 roadmap](https://github.com/oaslananka/boardreadyops/issues/192).

## Comment format

The review comment is designed to be scannable in a code review:

- **Decision line** — `✅ PASS` or `❌ FAIL` with the finding count, max severity, and (when available) the readiness score and policy result.
- **Severity table** — counts for critical / high / medium / low.
- **Top findings** — grouped by severity (highest first), each with the rule id, message, and source location. Each group is capped and notes how many more it omits.
- **Hardware impact** — when exact PR-base evidence exists, separates observed changed facts from BoardReadyOps' deterministic impact assessment.
- **Reports** — a link to the workflow run where the JSON/SARIF/Markdown/HBOM reports are uploaded as an artifact.

```markdown
## BoardReadyOps release review

**Decision: ❌ FAIL** — 4 finding(s), max severity high

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 4 |
| Medium | 0 |
| Low | 0 |

### Top findings

**High** (4)
- `design.board-outline` — PCB Edge.Cuts outline is open or missing. (`demo.kicad_pcb`)
- `bom.missing-mpn` — R1 is missing an MPN. (`demo-bom.csv:2`)
- …and 2 more.

### Hardware impact

Material change · risk increased · 3 affected domains

#### Changed facts

- Readiness: 82 → 71 (-11)
- Findings: +2 / -1; 1 new blocker
- BOM: 3 changed rows

#### Impact assessment

- Risk direction: increased
- Material change: yes
- Affected domains: readiness, findings, bom

### Reports
- [Reports (artifact: boardreadyops)](https://github.com/owner/repo/actions/runs/123)
```

The comment shares the sticky marker with the full report, so a repository posts exactly one BoardReadyOps comment per pull request.


## Exact-base comparison

Hardware impact compares the pull request's **exact base SHA** with the **exact analyzed head SHA**. BoardReadyOps does not substitute a newer, older, or merely same-branch run when the exact base result is unavailable. In that case the review says that exact-base evidence is unavailable; the current-run decision remains valid independently and no authoritative PR-change comparison is claimed.

Historical and current full JSON/report artifacts remain inside the target repository's GitHub Actions boundary. The hosted control plane receives only the bounded structured hardware-impact facts, assessment, and at most 12 evidence references; it does not receive the historical report artifact or source checkout.

## Installation

Add the BoardReadyOps Action to a pull request workflow and set `comment-format: review`:

```yaml
# .github/workflows/boardreadyops.yml
on:
  pull_request:
permissions:
  contents: read
  pull-requests: write
jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd # v6.0.2
      - uses: oaslananka/boardreadyops@9bc8a075d885ad1182e2ad4fcd4c9160f8160c94 # v1.31.2
        with:
          comment-format: review
```

The job needs `pull-requests: write` so the Action can post and update the review comment. Leave `comment-format` unset (or `report`) to keep the full Markdown report comment.

## See also

- [GitHub Action inputs](action.md) for the complete input reference.
- [Golden demo](golden-demo.md) for a board that produces the sample findings above.
- [Roadmap #192](https://github.com/oaslananka/boardreadyops/issues/192) for where the review app fits in the v2 plan.
