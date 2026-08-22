# JSON

The findings report is the stable diagnostics contract for automation consumers. It is versioned with `schemaVersion: 1` and validated by `schemas/findings.schema.json`.

`boardreadyops run --format json` and `boardreadyops check --format json` write the report to stdout. Command lifecycle logs and annotations stay on stderr. The older `--json <path>` and `--json -` report targets are still supported.

The report contains `schemaVersion`, `tool`, `status`, `exitCode`, `summary`, `projects`, `findings`, `fabrication`, and `generatedAt`; pull-request runs may also include the additive optional `hardwareImpact` object. `status` is `passed` when the CLI exit code is `0`; otherwise it is `failed`. Threshold failures still emit valid JSON before returning exit code `1`. Configuration and required-environment failures in JSON mode emit a valid report with diagnostics before returning their dedicated exit codes.

Findings emitted for a KiCad project include `project`, the owning `.kicad_pro` path relative to the workspace root. Consumers can group findings by that field without inferring ownership from a PCB, schematic, BOM, or manifest resource path.

Each finding includes stable `ruleId`, `severity`, `message`, `resource`, and `fingerprint` fields. Optional fields include `location`, `details`, `references`, `fix`, `confidence`, and `suppressed`. Severity values are `critical`, `high`, `medium`, `low`, and `info`.

Fabrication snapshots keep BOM source paths so pull request diffs can distinguish the same reference designator across configured projects.


## Optional `hardwareImpact`

Pull-request execution may add `hardwareImpact` without changing `schemaVersion: 1`. Consumers must treat the field as optional so reports from older producers remain valid.

The v1 object binds `baseline.sha` to the exact pull request base commit and `candidate.sha` to the exact analyzed head commit. `facts` contains observed deltas only: readiness score/status, finding counts, BOM row counts, and manufacturing-output counts. `assessment` is separate and contains the deterministic `materialChange`, `riskDirection` (`increased`, `decreased`, `unchanged`, or `unknown`), and affected domains (`readiness`, `findings`, `bom`, `manufacturing`).

When exact-base comparison cannot be established, `baseline.status` is `unavailable` with one bounded reason: `not-found`, `invalid-artifact`, `unsupported-result`, or `candidate-mismatch`. BoardReadyOps does not silently substitute another baseline, and unavailable impact does not invalidate the current run result.

`evidence` contains at most 12 bounded explanatory references. It is not a copy of source data or the historical report. Full previous/current reports and detailed fabrication diff artifacts remain in the target repository's workflow-artifact boundary.
