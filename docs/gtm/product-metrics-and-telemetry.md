# Product Metrics & Privacy-Safe Measurement Framework

*Date: August 31, 2026*
*Product Positioning: The trust layer between KiCad commits and manufacturing release.*

---

## 1. North Star Metric

```
                       ★ NORTH STAR METRIC ★
   Number of trusted, verified hardware PR and release decisions
           accepted, remediated, or blocked per month.
```

### Why This North Star?
- Measures true user value (prevented fabrication errors & confident release decisions), not superficial vanity metrics (website visits or raw lines of code).
- Aligns engineering incentive with customer success: reducing noise and false positives directly increases trusted decisions.

---

## 2. Privacy-Safe Measurement & Telemetry Policy

1. **Zero Outbound Telemetry by Default**: The standalone CLI binary and local workflows do **not** transmit analytics or telemetry over the internet.
2. **No Proprietary Data Collection**: Telemetry events never include file paths, component values, net names, schematic content, or secret tokens.
3. **Structured Local Diagnostics**: Diagnostics are written locally to `build/boardreadyops.findings.json` and local logs.

### Event Taxonomy (Structured Diagnostics Schema)

| Event Name | Trigger Stage | Payload Metadata (Privacy-Bounded) | Purpose |
| :--- | :--- | :--- | :--- |
| `setup.completed` | CLI `init` or doctor pass | `{ profile: string, kicad_version: string, os: string }` | Track onboarding friction and platform distribution. |
| `doctor.run` | `boardreadyops doctor` | `{ status: "pass" | "fail", failing_checks: string[] }` | Measure environment preparation failure modes. |
| `scan.completed` | `boardreadyops check` | `{ rule_count: number, findings_total: number, blocking: number, duration_ms: number }` | Measure execution performance and finding density. |
| `hardware_impact.generated` | PR Action run | `{ baseline_status: "available" | "unavailable", material_change: boolean, risk_direction: string }` | Track PR change impact adoption and baseline availability. |
| `waiver.evaluated` | Release gate evaluation | `{ active_count: number, expired_count: number, blocked_release: boolean }` | Track governance usage and expired waiver enforcement. |
| `release.prepared` | `release prepare` | `{ vendor_profile: string, signed: boolean, output_count: number }` | Measure release handoff and provenance generation. |

---

## 3. External Validation Exit Gates

Before expanding paid marketing or making commercial scalability investments, the product must satisfy these objective validation gates:

| Validation Gate | Target Threshold | Current State (Aug 2026) | Verification Method |
| :--- | :--- | :--- | :--- |
| **Time to First Useful Finding (TTFUF)** | **< 5 minutes** | Available (~2 mins via `check . --fail-on never`) | Golden demo & user onboarding testing. |
| **Actionable Finding Ratio** | **> 70%** | Available (Core rule corpus is deterministic) | Rule precision benchmarks against fixture zoo. |
| **False-Positive / Waiver Rate** | **< 20%** | Available | Ratio of waivers to total findings in benchmark suites. |
| **PR Hardware Impact Exact Binding** | **100% Deterministic** | Available (Verified on PR base/head SHAs) | `tests/unit/action/hardware-impact.test.ts`. |
| **Real Design Partner PR Cycles** | **≥ 3 Private Repos** | *External Validation Required* | 90-day design partner pilots with signed LOIs. |
| **Commercial Willingness to Pay** | **≥ 3 Paid Pilots / LOIs** | *External Validation Required* | Structured design partner proposals ($250–$750/mo). |
| **Active Organization Retention** | **≥ 70% at 8 weeks** | *External Validation Required* | Second board / release cycle repetition tracking. |
