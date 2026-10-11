# Non-normative clause-oriented Release Passport projection (#757)

The storage-neutral projectPassportAuditClauses helper groups existing Release Passport records by **reviewer-supplied** standard/clause IDs (ISO 13485, IATF 16949, AS9100, DO-254). It only reports which requested *passport fields* are recorded, partially recorded or absent.

**This is not certification, a standard-specific normative mapping, audit success, or a complete compliance export.** No official clause numbers or obligations are inferred. A customer must independently confirm the applicable standard edition, licensing, clause descriptions, required controls and mapping with their assessor. A self-consistent passport digest does not independently authenticate the issuer, reviewed source, fabrication output or manufacturer. Presence of an approval or waiver record is not evidence it satisfied the relevant clause.

This is a bounded #757 model foundation only. A usable export still requires reviewed clause definitions, explicit record provenance, clickable evidence, reviewer decisions and realistic audit acceptance. Do not represent partial or absent data as compliance.

## Local, offline JSON export

Provide a self-consistent Release Passport JSON and a separately reviewed clause-map JSON file:

```json
[
  {
    "standard": "ISO 13485",
    "clause": "reviewer-defined-id",
    "requiredEvidence": ["reviewed_revision", "release_decision", "evidence_manifest"]
  }
]
```

```bash
boardreadyops release audit-clauses release-passport.json --mappings reviewed-clauses.json > clause-records.json
```

The deterministic output is a machine-readable **record-presence projection**, grouped
by the supplied standard and clause identity. It reports `recordedEvidence`,
`missingEvidence`, and `recordCoverage` (`recorded`, `partial`, or `absent`). It
includes the self-reported passport digest and only a valid, clean source commit
**claim**, not an independently authenticated source-to-export binding.

The command reads only local files (each input at most 1 MiB), writes only stdout,
and fails closed on invalid passport digests, unsupported clause identities, or
duplicated requirements. Pipe its JSON to a file for review. No online catalogue,
normative requirement text, third-party signature validation, or certification
claim is built into this export.
