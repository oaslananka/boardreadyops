# Multi-CAD Customer Discovery & Pilot Outreach Framework

This document outlines the structured customer interview protocol, target discovery cohorts, and outbound engagement templates to validate the multi-CAD BoardReadyOps platform and acquire the first 10 commercial pilot organizations.

---

## 1. Target Cohorts & Qualification Matrix

| Cohort | Profile | Primary CAD Tools | Critical Pain Points | Target Sample Size |
| :--- | :--- | :--- | :--- | :--- |
| **Cohort A: Independent Engineers** | Freelance EEs, hardware creators, open-hardware product designers. | KiCad, EasyEDA Pro | Component obsolescence, single-source risk, out-of-pocket respin costs ($500–$2,000). | 5 interviews |
| **Cohort B: Design Consultancies** | Boutique hardware design agencies (2–10 EEs) delivering client turnkeys. | Altium Designer, KiCad | Client approval friction, "it worked on my screen" disputes, unverified BOM revisions. | 5 interviews |
| **Cohort C: Quick-Turn EMS / Fabs** | Pre-flight CAM departments, rapid prototyping PCBA fabricators. | Gerber, IPC-2581, ODB++ | Incomplete packages (missing drill, mismatched centroid, unflagged polarity), high engineering inquiry (EQ) volume. | 3 interviews |

---

## 2. Discovery Interview Protocol (The Mom Test Framework)

### Objective
Uncover concrete historical behavior, actual financial/schedule loss, and current manual workarounds without pitching hypothetical features.

### Phase 1: Current Pre-Flight & Review Reality (10 minutes)
1. "When you finish schematic and PCB layout, what exact steps do you take before placing a fabrication order?"
2. "Who checks your manufacturing files (Gerbers, Drill, BOM, Centroid)? What tool or checklist do they use?"
3. "How do you share hardware changes with non-CAD stakeholders (clients, firmware team, managers)?"

### Phase 2: Past Manufacturing Failures & Financial Impact (15 minutes)
4. "Tell me about the last time a batch of prototype or production boards arrived with an issue or didn't work."
   - *Probe:* What was the exact root cause (mismatched BOM MPN, missing pin 1 marker, bottom-side centroid mirroring, clearance violation)?
   - *Probe:* How long did it take to identify the defect?
   - *Probe:* What was the financial impact (scrapped boards, rush shipping, engineer overtime, missed milestone)?
5. "When working across multiple CAD formats (e.g. client sends Altium, your team uses KiCad or EasyEDA), where does translation break down?"
6. "Have you ever had a client dispute whether an error was in the design file or introduced during assembly?"

### Phase 3: Commercial Valuation & Pilot Feasibility (10 minutes)
7. "What commercial tools or services have you purchased in the past 12 months for design review or DFM?"
8. "If an automated pre-flight tool gave you a sealed, cryptographically signed release package with client web sign-off, what would that save your team per release?"
9. "Who owns the software and productivity budget for hardware tools at your organization?"

---

## 3. Outbound Outreach Templates

### Template 1: Boutique Hardware Design Consultancies (Cohort B)
**Subject:** Quick question regarding [Firm Name]'s hardware release sign-off process

> Hi [First Name],
>
> I came across [Firm Name]'s recent work on [Project or Client Case Study] — fantastic design execution.
>
> We are speaking with hardware engineering leads and design agency directors about how they verify manufacturing packages (Altium/KiCad Gerbers, BOM, and Pick-and-Place) before sending files to fabrication.
>
> In our initial research with consultancies, the two biggest bottlenecks are catching last-minute component availability changes and obtaining client sign-off on release packages without sending raw CAD files back and forth.
>
> Would you be open to a brief 20-minute discussion this week to share how [Firm Name] handles pre-flight review? No sales pitch — purely research on hardware delivery workflows.
>
> Best regards,
> [Your Name]
> Founder, BoardReadyOps

---

### Template 2: Freelance Engineers & Creators (Cohort A)
**Subject:** Board respins and BOM pre-flight checks

> Hi [First Name],
>
> Loved your write-up on [Hardware Project/Blog Post].
>
> I am building developer tooling for hardware engineers to eliminate the dread of ordering a batch of PCBs and discovering an out-of-stock component or missing pin-1 marker after assembly starts.
>
> If you have experienced a frustrating fabrication delay or scrap board recently, I would love to hear your story in a quick 15-minute chat.
>
> As a thank-you, I’d be happy to run your next board package through our multi-CAD verification engine and provide a complete pre-flight DFM report for free.
>
> Best,
> [Your Name]

---

### Template 3: PCB Assembly / Fabricator Pre-Flight Teams (Cohort C)
**Subject:** Reducing engineering inquiries (EQs) on incoming customer packages

> Hi [First Name],
>
> I lead engineering at BoardReadyOps. We are collaborating with PCB assembly teams to reduce the volume of pre-flight engineering inquiries (EQs) on incoming multi-CAD packages.
>
> Most fabricators spend 30–90 minutes per job resolving missing drill files, unplaced polarity marks, and discontinued MPNs before panelization.
>
> We have built a zero-install, multi-CAD pre-flight validation engine that verifies KiCad, Altium, and EasyEDA packages before customers submit them.
>
> Would you be open to a 20-minute chat on the most frequent data defects your CAM engineers catch, and whether automated client-side pre-flight checks could save your team time?
>
> Cheers,
> [Your Name]

---

## 4. Pilot Qualification & Conversion Scorecard

To transition a discovery interviewee into a $450/month Paid Pilot, evaluate against:

- [ ] **Release Cadence:** Releases at least 1 board revision per month.
- [ ] **Multi-Stakeholder Delivery:** Shares hardware designs with external clients or contract manufacturers.
- [ ] **Verified Historical Pain:** Suffered at least one board delay/respin costing > $1,500 in the past 12 months.
- [ ] **Budget Authority:** Principal engineer, agency founder, or VP Engineering with discretionary software spend.
- [ ] **Pilot Commitment:** Agrees to evaluate 3 real board releases in exchange for weekly direct engineering support and SLA monitoring.
