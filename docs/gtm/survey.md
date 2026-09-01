# Quantitative Survey: Hardware Release Gates & KiCad Review Workflow

*Goal: Quantify release pain points, CI adoption barriers, and willingness to pay among professional KiCad engineering teams.*
*Target Sample Size: N = 50–100 respondents across hardware startups, mid-market IoT, and robotics firms.*

---

## 1. Survey Metadata & Hypotheses

- **Primary Hypothesis**: > 65% of hardware teams experience at least one fabrication re-spin per year caused by avoidable BOM, footprint, or export synchronization errors.
- **Secondary Hypothesis**: > 80% of teams using GitHub for KiCad want automated PR change impact summaries without uploading design files to third-party clouds.

---

## 2. Survey Questions

### Section 1: Demographics & Tech Stack
1. **What is your primary role?**
   - [ ] Electrical Engineer / Hardware Designer
   - [ ] Hardware Engineering Manager / Director
   - [ ] Embedded Systems / Firmware Engineer
   - [ ] PCB Layout Specialist
   - [ ] Other: ______

2. **How many active hardware engineers are on your team?**
   - [ ] 1–2
   - [ ] 3–10
   - [ ] 11–25
   - [ ] 26+

3. **Which KiCad version(s) do you actively use in production?**
   - [ ] KiCad 9
   - [ ] KiCad 8
   - [ ] KiCad 7 or older
   - [ ] KiCad Nightly / v10 development

4. **Where do you host and version-control your hardware repositories?**
   - [ ] GitHub (Cloud / Enterprise)
   - [ ] GitLab (Cloud / Self-hosted)
   - [ ] Bitbucket
   - [ ] Local Git / Network drives only

---

### Section 2: Review Workflow & Release Pain
5. **How does your team review hardware pull requests or commits today? (Select all that apply)**
   - [ ] Manual visual inspection in KiCad desktop
   - [ ] Screenshots pasted into PR comments
   - [ ] PDF schematic diffs / manual exports
   - [ ] Automated CI checks (DRC / ERC scripts)
   - [ ] We do not perform formal PR reviews for hardware

6. **In the past 12 months, how many board fabrication re-spins did your team experience?**
   - [ ] 0
   - [ ] 1–2
   - [ ] 3–5
   - [ ] 6+

7. **What was the primary root cause of your most expensive hardware defect?**
   - [ ] Incorrect or missing BOM Part Number (MPN)
   - [ ] Footprint pinout or polarity mismatch
   - [ ] Fabrication output mismatch (stale Gerbers / Drill / CPL)
   - [ ] Mechanical / board outline clearance issue
   - [ ] Firmware/Hardware pin assignment conflict
   - [ ] Other: ______

---

### Section 3: Value Proposition & Pricing
8. **If an automated GitHub Action could analyze every KiCad PR and report exactly what changed with risk indicators, how valuable would this be?**
   - [ ] Essential / Must-have
   - [ ] Very useful
   - [ ] Nice to have
   - [ ] Not useful

9. **What is your organization's stance on uploading hardware design files (schematics/PCBs) to third-party cloud SaaS?**
   - [ ] Strictly forbidden (requires 100% local/self-hosted processing)
   - [ ] Discouraged / requires infosec approval
   - [ ] Allowed if SOC 2 / GDPR compliant
   - [ ] No restrictions

10. **What pricing model would your team prefer for a hardware release gate?**
    - [ ] Free open-source core CLI + paid team collaboration features ($20–$50/seat/month)
    - [ ] Flat organization license ($250–$1,000/year)
    - [ ] Pay-per-manufactured board release
    - [ ] Free open-source only
