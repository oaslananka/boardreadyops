# Design Partner Pilot Scorecard & Evaluation Criteria

*Customer Name: {{Company_Name}}*
*Evaluation Period: {{Start_Date}} to {{End_Date}} (60–90 days)*
*Owner: {{Customer_Lead_EE}} / {{Provider_Lead}}*

---

## 1. Pilot Goals & Success Criteria

The pilot is evaluated against three core operational dimensions:
1. **Time-to-Value (Activation)**: Rapid initial scan and pull request comment integration.
2. **Finding Accuracy & Signal-to-Noise**: High ratio of actionable, valid findings vs false alarms.
3. **Engineering Time & Scrap Reduction**: Measurable reduction in manual review friction and prevented defect costs.

---

## 2. Quantitative Evaluation Matrix

| Metric | Target Goal | Baseline (Manual) | Pilot Actual | Status (Pass / Fail) |
| :--- | :--- | :--- | :--- | :--- |
| **Time to First Useful Finding (TTFUF)** | < 15 minutes | N/A | TBD | Pending |
| **PR Review Latency Impact** | < 45 seconds / PR | 2–4 hours | TBD | Pending |
| **False Positive Rate** | < 10% of total findings | > 25% (manual noise) | TBD | Pending |
| **Prevented Pre-Fab Risks** | ≥ 1 blocking finding / board | 0 (caught at fab) | TBD | Pending |
| **Hardware Change Impact Utility** | ≥ 80% reviewer approval | Manual screenshot diff | TBD | Pending |
| **Zero Security / Data Leakage** | 100% compliant | N/A | TBD | Pending |

---

## 3. Qualitative Reviewer Feedback Log

| PR / Commit | Rule / Feature | Reviewer Verdict | Notes & Engineering Feedback |
| :--- | :--- | :--- | :--- |
| Example: PR #42 | `bom.missing-mpn` | Valid Blocker | Caught missing resistor network MPN before placing PCB assembly order. |
| Example: PR #45 | `Hardware Impact` | Highly Actionable | Clear summary showing only silkscreen changed; expedited review. |
| {{PR_Number}} | {{Rule_Id}} | {{Valid / False Alarm / Useful}} | {{Reviewer_Comments}} |

---

## 4. Final Evaluation & Go/No-Go Decision Gate

- [ ] **Technical Validation Approved**: Hardware team confirms tool delivers accurate risk signals.
- [ ] **Security & Privacy Approved**: Local-first architecture verified with zero design IP leakage.
- [ ] **Commercial Conversion**: Decision to proceed with Team / Business plan subscription.
