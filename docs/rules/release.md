# Release Rules

- [release.artifact-provenance](release.artifact-provenance.md): Checks self-reported source-file fingerprints and exported Gerber/drill artifact hashes; this does not authenticate a reviewed commit or export runner.
- [release.changelog-present](release.changelog-present.md): Checks CHANGELOG.md for an entry matching the board revision.
- [release.revision-set](release.revision-set.md): Checks PCB title-block revisions against the configured release tag pattern.
- [release.tag-matches-revision](release.tag-matches-revision.md): Checks tag CI context against the board revision recorded in PCB metadata.
- [release.version-format](release.version-format.md): Checks schematic and PCB revisions against the configured release version pattern.
