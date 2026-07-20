## ❌ BoardReadyOps: Release blocked

| Field | Value |
| --- | --- |
| Outcome | ❌ Release blocked |
| Status | Completed |
| Decision | Fail |
| Readiness | 42/100 · Blocked |
| Findings | 1 blocking · 1 warning · 2 total |
| Waivers | 0 active · 1 expired |
| Artifacts | 0 |
| Duration | 3.2 s |

### Blocking findings

- **high** `pcb.unrouted` (`board.kicad_pcb`): Two tracks remain unrouted.

### Warnings

- **medium** `bom.review`: Review the BOM lifecycle state.

### Readiness notes

- Required output gerbers is missing.

### Expired waivers

- `pcb.unrouted` · hardware-team · matched 1 · expires `2026-07-01`: Prototype exception expired.

### Reports

- [HTML report](https://reports.example.test/run-failure)

### Next steps

- Resolve the blocking findings and missing required outputs.
- Re-run BoardReadyOps and review the updated evidence.

[Open hosted run dashboard](https://boardreadyops.test/runs/run-failure)

<!-- boardreadyops:release-readiness -->
