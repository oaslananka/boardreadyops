# GTM Templates & Customer Discovery Artifacts

*Date: August 31, 2026*  
*Collection: Discovery scripts, pilot proposals, non-binding LOI, and security answers.*

---

## 1. 10-Question Customer Discovery Interview Guide

**Target Persona**: Lead Hardware Engineer, Director of Hardware Engineering, PCB Designer.  
**Interview Objective**: Uncover real-world PCB respin causes, PR review bottlenecks, and willingness to pay for automated policy gates.

```markdown
### Introduction (2 mins)
"Thanks for chatting today. We're researching how hardware engineering teams review KiCad designs in GitHub and catch manufacturing errors before fabrication. No sales pitch today—we want to understand your real workflow and frustrations."

### Questions (20 mins)
1. Walk me through what happens when an engineer finishes a PCB layout revision in KiCad and wants to merge it. Who reviews it, and how?
2. What exact checks do you run before sending Gerbers and BOM to your fabricator (JLCPCB, PCBWay, etc.)?
3. When was the last time a board came back from fabrication with a bug (wrong footprint, backwards diode, obsolete part, unconnected net)? What went wrong?
4. How much did that respin cost you in real terms (fab fees, component loss, technician rework, and weeks of delayed schedule)?
5. When reviewing a teammate's hardware pull request in GitHub, how do you know what changed between the schematic and layout?
6. Have you ever had a prototype shortcut or temporary component hack accidentally slip into a production build? How do you track waivers today?
7. Do you use any automated CI checks in GitHub Actions today for KiCad? If not, what has held you back?
8. How does your company handle intellectual property security when using developer tools? (Are you allowed to upload schematics to cloud SaaS?)
9. If you had a tool running in your GitHub PRs that highlighted exact physical/BOM changes and blocked unapproved release risks locally, who in your org would decide to adopt it?
10. If this tool prevented one $5,000 respin every quarter, what software budget category would you use to purchase it?
```

---

## 2. Non-Binding Letter of Intent (LOI) Template

```markdown
# NON-BINDING LETTER OF INTENT (DESIGN PARTNER PILOT)

**Date**: [Date]  
**Between**: BoardReadyOps ("Provider") and [Company Name] ("Participant")  

### 1. Purpose & Scope
Participant intends to participate as a Design Partner in the BoardReadyOps Hardware Review & Release Gate Pilot. The purpose of this pilot is to evaluate automated KiCad PR review, BOM preflight, and release evidence generation within Participant's development workflows.

### 2. Pilot Structure
- **Duration**: 90 days from deployment.
- **Scope**: Up to [Number] KiCad hardware repositories on GitHub.
- **Support**: Direct engineering access via dedicated Slack/Discord channel; weekly feedback syncs.

### 3. Commercial Intent
If Participant successfully validates the Pilot Acceptance Criteria defined below during the 90-day evaluation period, Participant intends to enter good-faith negotiations to subscribe to the BoardReadyOps Team or Business tier at an agreed rate of [$Amount] / month.

### 4. Pilot Acceptance Criteria
- [ ] BoardReadyOps runs automatically on all hardware pull requests in target repositories.
- [ ] Deterministic Hardware Change Impact summaries are posted to PR reviews within <60 seconds.
- [ ] At least one potential fabrication blocker or BOM risk is surfaced and remediated prior to fab ordering.
- [ ] Zero source code or proprietary design files are exfiltrated outside Participant's GitHub environment.

### 5. Non-Binding Nature
This Letter of Intent represents a statement of mutual interest and goodwill only. Neither party is legally bound to purchase or license software until a definitive Commercial Agreement is executed.

**For Participant:**  
Name: __________________________  Title: __________________________  Date: ______________  

**For BoardReadyOps:**  
Name: __________________________  Title: __________________________  Date: ______________  
```

---

## 3. Security & Privacy Questionnaire Responses (FAQ)

```markdown
### Frequently Asked Security Questions

**Q1: Does BoardReadyOps upload our PCB schematics, board layouts, or Gerber files to an external cloud?**  
**A**: No. The open-source BoardReadyOps CLI and GitHub Action run entirely within your local workstation or your private GitHub Actions runner. Source files, netlists, and schematics never leave your compute boundary.

**Q2: How does BoardReadyOps verify permissions for 3rd-party plugins?**  
**A**: BoardReadyOps enforces a default-deny capability model. Plugin manifests are statically evaluated before execution, and plugins requesting unapproved filesystem, process, or network access are rejected before any code is loaded.

**Q3: Does BoardReadyOps send tracking telemetry or phone home by default?**  
**A**: No. The CLI has zero default outbound network telemetry. Diagnostic logs are written locally to your terminal and `build/` directory.

**Q4: How are release evidence bundles protected against tampering?**  
**A**: Evidence manifests contain SHA-256 digests of all generated manufacturing outputs and can be cryptographically signed using Ed25519 asymmetric keys for offline verification.
```
