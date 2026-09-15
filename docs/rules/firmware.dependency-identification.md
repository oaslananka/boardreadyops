---
id: firmware.dependency-identification
severity-default: info
applies-to:
  - project
config-keys:
  - rules.firmware.dependency-identification.enabled
---

# firmware.dependency-identification

## What It Checks

Reports how many ESP-IDF dependencies have an identifier a vulnerability database indexes.

## When It Fires

Always reports, informationally, when an ESP-IDF component manifest declares dependencies. States how many have an identifier a vulnerability database indexes and names the ones that do not, so a reader cannot mistake "not vulnerability-indexed" for "no advisories found".

## Configuration Example

```yaml
version: 1
rules:
  firmware.dependency-identification:
    enabled: true
    severity: info
```

## JSON Finding Details Shape

```text
{ total, searchable, unidentified, unidentifiedNames }
```

## Report Context

Use this finding to decide whether the design package is ready for review, fabrication, or release. BoardReadyOps reports the condition and leaves design edits to the owning workflow.
