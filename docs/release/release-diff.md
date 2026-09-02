# Release Diff

`boardreadyops release diff <previous> [path]` compares the current state of a project against a previous release so reviewers can see exactly what changed between two releases.

```bash
boardreadyops release diff build/previous-release.report.json .
boardreadyops release diff build/boardreadyops-release --format json --output build/release-diff.json
```

## Previous release input

The `<previous>` argument accepts either:

- a previous BoardReadyOps JSON report (the file written by `report.json` or `release pack`), or
- an evidence bundle directory — the command reads `reports/boardreadyops-report.json` from it.

The current side is produced by running the normal pipeline on `[path]` (default `.`), so the diff always reflects the project as it is now.

## What is compared

- **BOM** — added, removed, and changed components (by reference and source), reusing the fabrication diff.
- **Outputs / CPL** — fabrication output kinds (Gerber, drill, position/CPL, …) compared by file digest, so a changed placement file is reported as a changed `position` output.
- **Findings** — findings added and removed between the two releases, by fingerprint, plus a **worsened/improved** breakdown: findings present in both releases (same fingerprint) whose severity changed. A finding's fingerprint does not include its severity, so a finding matched as "unchanged" can still have gotten more or less severe.
- **Readiness** — the [readiness score](readiness-scoring.md) delta, status change, and which required outputs became newly missing or were resolved.

## Output

The diff is available as JSON (`--format json` or `--output <file>`):

```json
{
  "schemaVersion": 1,
  "summary": {
    "bomChanged": 2,
    "outputsChanged": 1,
    "findingsAdded": 1,
    "findingsRemoved": 1,
    "findingsWorsened": 0,
    "findingsImproved": 0,
    "scoreDelta": 20
  },
  "readiness": {
    "previousScore": 60,
    "currentScore": 80,
    "scoreDelta": 20,
    "statusChanged": true,
    "resolvedRequired": ["drill"],
    "newlyMissingRequired": []
  },
  "fabrication": { "bom": { "rows": [] }, "outputs": [], "findings": {} }
}
```

The default text format prints a compact summary of the readiness change, BOM and output changes, and the net findings delta — including worsened/improved counts and a `worsened findings:` / `improved findings:` detail section listing each finding's severity transition (e.g. `low -> critical design.clearance at board.kicad_pcb`). The command exits `0`; it reports differences rather than gating a release.

The worsened/improved breakdown is not yet visualized in the `--html` dashboard below (only added/removed findings are); it is available today in the JSON and text output.

## HTML dashboard

Pass `--html <path>` to render a visual release dashboard alongside the JSON/text output:

```bash
boardreadyops release diff build/previous-release.report.json . --html build/release-diff.html
```

The dashboard reuses the standard report shell — release decision, readiness, and findings — and adds a **Fabrication Changes** section directly under the decision banner. BOM rows are shown with their previous and current values, manufacturing outputs list their per-file change counts, and newly introduced findings are highlighted. Each change carries a color-coded status badge (added, removed, changed, unchanged). The page is self-contained, dark-mode aware, and passes WCAG 2.1 A/AA accessibility checks.
