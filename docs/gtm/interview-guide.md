# Customer Discovery Interview Guide: KiCad Hardware Release & Review Gates

*Target Cohort: Hardware Engineering Leads, Principal EEs, PCB Designers, and Hardware DevOps/Release Engineers.*
*Framework: Mom Test / Jobs-to-be-Done (JTBD) customer problem discovery.*

---

## 1. Research Objectives & Evidence Classification

| Dimension | Classification | Research Target |
| :--- | :--- | :--- |
| **Problem Frequency** | `Hypothesis` | EEs order scrap boards at least 1–2 times per year due to preventable silkscreen/BOM/footprint errors. |
| **Current Workarounds** | `Hypothesis` | Manual Excel checklists, screenshot-based PR reviews, or zero formal CI checks. |
| **Decision Threshold** | `Hypothesis` | Teams will adopt an automated PR gate if it sets up in < 15 minutes and emits < 10% false positives. |
| **Willingness to Pay** | `External Validation Required` | $20–$50/seat/month for automated PR impact and supply watch. |

---

## 2. Interview Protocol & Screening

- **Duration**: 30–45 minutes.
- **Recording/Notes**: Explicit consent requested; focus on past behaviors and actual past spending rather than speculative opinions.
- **Screening Criteria**:
  - Uses KiCad (v8, v9, or v10) for production or serious prototype hardware.
  - Collaborates using Git/GitHub for schematic and PCB version control.
  - Releases hardware designs to manufacturing (JLCPCB, PCBWay, OSH Park, or tier-1 EMS) at least quarterly.

---

## 3. Interview Question Script

### Part 1: Current Workflow & Team Context (10 mins)
1. "Can you walk me through the lifecycle of your most recent PCB revision from schematic capture to ordering boards?"
2. "How many engineers review a board before it is sent to the fab house? How do you conduct that review today?"
3. "How do you track what actually changed between Revision A and Revision B in GitHub pull requests?"

### Part 2: Pain Points & Past Failures (15 mins)
4. "Tell me about the last time a manufactured board arrived from the fab house with a bug or defect."
   - *Probe*: What was the root cause (BOM MPN, footprint pinout, open outline, clearance, polarity marker)?
   - *Probe*: At what stage was this bug introduced? Why wasn't it caught during design review?
   - *Probe*: What was the total cost (spin delay, scrap cost, engineer hours)?
5. "How do you currently verify that your BOM, CPL, and Gerber files are 100% in sync before placing an order?"
6. "Have you tried automating checks in GitHub Actions or CI? If yes, what failed or caused maintenance headaches?"

### Part 3: Tooling & Willingness to Pay (10 mins)
7. "What commercial or open-source tools have you purchased or evaluated for hardware review or DFM?"
8. "If a tool automatically posted a summary of hardware change impacts and blocked unreviewed blocker issues on PRs, how would you evaluate whether to keep it?"
9. "Who in your company owns the budget for developer and engineering productivity tooling?"

---

## 4. Synthesis & Decision Gate Framework

| Outcome Signal | Strong Go | Weak / Neutral | Stop / Pivot Indicator |
| :--- | :--- | :--- | :--- |
| **Pain Intensity** | Cites specific $1k–$10k+ board scrap event in last 6 months. | "Review is fine, we just double-check things." | "We only build one hobby board a year." |
| **Tooling Demand** | Actively looking for KiCad GitHub Actions gate. | Open to trying free CLI. | Refuses to run CI for hardware. |
| **IP Sensitivity** | Requires local-first / zero-trust architecture. | Indifferent to cloud vs local. | Demands complete hosted SaaS repository mirror. |
