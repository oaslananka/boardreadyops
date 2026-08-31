# Ideal Customer Profile (ICP) & Jobs To Be Done (JTBD)

*Date: August 31, 2026*  
*Product Positioning: The trust layer between KiCad commits and manufacturing release.*

---

## 1. Ideal Customer Profile (ICP)

### Firmographics
- **Team Size**: 2 to 20 electrical, firmware, and hardware engineers.
- **Organization Verticals**:
  - Robotics & Autonomous Systems
  - Embedded IoT & Connected Industrial Devices
  - Contract Design Houses & Electronics Manufacturing Services (EMS)
  - Medical Devices & Agritech Hardware Startups
- **Tooling Stack**:
  - Primary EDA: **KiCad 8, 9, or 10**
  - Primary Version Control & CI: **GitHub (Cloud or Enterprise Server)**
  - Manufacturing Partners: **JLCPCB, PCBWay, OSH Park, or domestic quick-turn fabs**

### Buyer Personas & Buying Center

| Persona | Title Examples | Primary Motivation & Pain | Role in Purchase |
| :--- | :--- | :--- | :--- |
| **End User** | Hardware Engineer, PCB Layout Designer | Frustrated by manual DRC checks, silent footprint mismatches, and messy BOM diffs before fab orders. | **User & Evaluator**: Adopts CLI locally, requests GitHub Action in PRs. |
| **Internal Champion** | Lead EE, Principal Hardware Engineer | Needs consistency across junior engineers, wants clear PR reviews without manually cross-referencing schematics. | **Champion**: Drives standard configuration, writes custom rule packs. |
| **Economic Buyer** | VP of Engineering, CTO, Hardware Startup Founder | Terrified of expensive PCB respins ($2k–$20k + 3 weeks lost), delayed product launches, and untracked prototype shortcuts. | **Decision Maker**: Approves Team / Business subscription budget. |
| **Procurement Blocker** | Security Lead, Legal / IP Counsel | Concerned about cloud leaks of unreleased proprietary schematics and PCB IP. | **Gatekeeper**: Demands Local-First / Zero-Trust architecture without external cloud storage. |

---

## 2. Jobs To Be Done (JTBD) Framework

### Core Job Statement
> *"When our hardware team is reviewing a pull request or preparing a manufacturing release, we want an automated, explainable check that detects physical, electrical, and supply chain risks between revisions, so that we can order fabricated boards with zero respins and 100% confidence."*

### Key Micro-Jobs & Outcome Expectations

| Job # | When (Trigger) | I want to... | So that I can... | BoardReadyOps Solution |
| :--- | :--- | :--- | :--- | :--- |
| **JTBD 1** | A teammate opens a hardware PR modifying the PCB or schematic. | See an instant, exact diff of modified nets, added components, and footprint changes in GitHub. | Review the PR in 5 minutes without opening KiCad and manually overlaying layers. | **PR-Native Hardware Change Impact**: Deterministic delta comparing exact base SHA to candidate SHA. |
| **JTBD 2** | An engineer updates a resistor or IC in the schematic. | Automatically verify that the BOM MPN exists, matches the footprint, is active (not EOL/NRND), and meets compliance. | Avoid discovering an out-of-stock or obsolete component when the board is already being manufactured. | **BOM & Footprint Preflight Rules**: `bom.missing-mpn`, `bom.lifecycle`, `bom.footprint-mismatch`. |
| **JTBD 3** | We need to build 5 prototype boards with a known temporary flaw. | Document an approved, time-bounded waiver with an owner and expiration date. | Proceed with testing without letting the prototype hack accidentally reach the production factory release. | **Governance & Waivers**: `waivers` schema with automated expiration enforcement. |
| **JTBD 4** | Preparing the final ZIP archive to send to JLCPCB / PCBWay. | Generate a complete, verified handoff package with an Ed25519-signed evidence manifest. | Prove exactly which commit and evidence created the manufactured physical boards. | **Release Prepare & Handoff Pipeline**: `boardreadyops release prepare` + `boardreadyops handoff create`. |
| **JTBD 5** | Company security policy prohibits uploading schematics to 3rd-party SaaS. | Run the entire preflight and gating engine inside our local workstations and self-hosted CI runners. | Keep 100% of our hardware IP and trade secrets strictly within our firewall. | **Local-First Zero-Trust Design**: Zero cloud dependencies for core validation and reporting. |

---

## 3. Objection Handling & Buying Journey

```
Stage 1: Awareness
  "We just use KiCad's built-in DRC. Why do we need this?"
  ↳ Answer: KiCad DRC checks geometry, not BOM lifecycle, pin contracts, PR change impact, or release waivers.

Stage 2: Evaluation
  "Does this upload our schematics to a cloud server?"
  ↳ Answer: No. BoardReadyOps runs entirely in your local terminal or GitHub Actions runner.

Stage 3: Decision
  "Can we start free and only pay when we need organization governance?"
  ↳ Answer: Yes. Community edition is 100% open source and forever free for individual repos.
```
