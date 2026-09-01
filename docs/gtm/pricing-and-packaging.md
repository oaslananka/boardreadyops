# Pricing & Packaging Strategy (August 2026)

*Status: Test Hypotheses & Commercial Packaging Architecture*
*Product Positioning: The trust layer between KiCad commits and manufacturing release.*

---

## 1. Plan Tier Overview

```
┌─────────────────────────┐   ┌─────────────────────────┐   ┌─────────────────────────┐
│     Community Tier      │   │        Team Tier        │   │      Business Tier      │
│          $0/mo          │   │      $49-$99/mo         │   │      $299-$499/mo       │
│      (Open Source)      │   │      (Test Hyp A/B)     │   │      (Custom Terms)     │
├─────────────────────────┤   ├─────────────────────────┤   ├─────────────────────────┤
│ • Unlimited local CLI   │   │ • Everything in Comm.   │   │ • Everything in Team    │
│ • GitHub Action PR gate │   │ • Organization policies │   │ • Self-hosted dashboard │
│ • Core DFM & BOM rules  │   │ • PR Hardware Impact    │   │ • Multi-tenant worker   │
│ • Local JSON/SARIF/HTML │   │ • Time-bounded waivers  │   │ • Signed audit export   │
│ • Standard vendor prof. │   │ • Expired waiver block  │   │ • Custom rule packs     │
│ • Community support     │   │ • Email/Slack support   │   │ • Dedicated onboarding │
└─────────────────────────┘   └─────────────────────────┘   └─────────────────────────┘
```

---

## 2. Pricing Hypotheses for Validation

*Note: All pricing numbers below are structured test hypotheses to be validated through design partner pilots and qualitative interviews.*

### Hypothesis A: Active Repository Model
- **Price**: **$49 / month** for up to 3 active hardware repositories; **$15 / additional repo / month**.
- **Target Persona**: Small hardware consultancy or seed-stage robotics startup.
- **Value Metric**: Number of actively developed KiCad repositories. Unlimited contributors and reviewers.

### Hypothesis B: Active Engineer Seat Model
- **Price**: **$19 / active engineer seat / month** (Billed annually at $228/yr).
- **Free Reviewers**: Unlimited free read-only reviewer and manager seats.
- **Target Persona**: Scale-up engineering teams (10–50 engineers).

### Hypothesis C: Design Partner Pilot Package
- **Price**: **$450 / organization / month** (3-month structured pilot).
- **Inclusions**:
  - Dedicated private Slack/Discord channel with core maintainers.
  - Setup assistance for custom fabricator rule packs.
  - Joint case study and priority roadmap influence.

### Hypothesis D: Enterprise Contract Discovery Band
- **Price**: **$15,000 – $45,000 / year**.
- **Inclusions**: Self-hosted Docker/Compose control plane, air-gapped license keys, SSO/SAML integration, custom procurement terms, and SLA guarantee.

---

## 3. Strict Packaging Boundaries: What Stays Free Forever

To maintain developer trust and open-source vitality, BoardReadyOps enforces a strict boundary:

### Open Source Core (Community - $0):
- **Never Paywalled**: Core CLI binary, GitHub Action runner, built-in KiCad rule corpus, local reports (JSON, SARIF, Markdown, HTML, JUnit), `boardreadyops generate`, `boardreadyops doctor`, and offline verification.
- We do **NOT** artificially cripple the CLI or inject nagware.

### Premium Value Axis (Team / Business):
- Premium value is derived from **governance, risk management, and team collaboration**:
  1. Organization-wide policy packs and enforceable standards.
  2. Multi-engineer waiver approval workflows with automated expiration tracking.
  3. Historical release-to-release evidence comparison and drift auditing.
  4. Enterprise fabricator handoff packaging and supply-chain SLA validation.

---

## 4. Upsell & Upgrade Triggers

1. **Second Hardware Project / Scaled Team**: A team moves from 1 engineer running the CLI to 4 engineers opening PRs requiring unified policy enforcement.
2. **First Production Fabricator Run**: Moving from loose prototype checks to strict release policy with mandatory waiver owners before spending $10k+ on fabrication.
3. **External Audit or Customer Handover**: An EMS or medical client requires verifiable evidence manifests for every delivered revision.
