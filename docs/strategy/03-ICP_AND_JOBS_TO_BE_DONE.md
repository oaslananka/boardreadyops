# ICP and Jobs To Be Done

## Primary initial ICP

### Hardware startup / small product team

Typical shape:

- roughly 5–30 engineering contributors;
- GitHub-centric development;
- KiCad or an accessible file-based hardware workflow;
- outsourced PCB fabrication/assembly;
- limited dedicated release/process staff;
- real cost from wrong revisions, BOM mistakes, late DFM findings, and weak traceability.

Primary pain:

> “Do not let us send the wrong or unsafe hardware state to manufacturing.”

Why attractive:

- short buying/feedback loop;
- direct access to engineers;
- release mistakes are concrete and expensive;
- less entrenched PLM/process tooling;
- GitHub/CI workflow fit.

## Secondary ICP

### Growing hardware organization

Typical shape:

- 30–150+ engineers;
- multiple repositories/products/variants;
- repeated releases and manufacturing batches;
- growing need for policy, approvals, audit, supply-chain monitoring, and portfolio views.

Primary pain:

> “Which products are ready, which are exposed, who approved the release, and what exactly shipped?”

This is the strongest candidate for recurring Cloud expansion.

## Later enterprise ICP

Needs may include:

- SSO/SCIM;
- customer-hosted execution;
- audit and retention controls;
- data residency or dedicated infrastructure requirements;
- organization policy hierarchy;
- contractual support/SLA;
- integration into PLM/ERP/security/compliance systems.

Enterprise requirements should be pulled by real opportunities rather than prebuilt generically.

## Jobs To Be Done

### Hardware engineer

When I change a board, tell me what hardware-relevant behavior changed and whether I introduced production risk before I merge or release it.

### Release owner

When we create a manufacturing release, generate and verify the exact package, policy decision, evidence, signatures, and handoff state so nobody has to reconstruct it manually.

### Engineering manager

When I look across products, show me which repositories/releases need attention and why, without requiring me to inspect every KiCad project.

### Supply-chain / component owner

When component lifecycle, availability, sourcing, or compliance information changes, show which active products/releases are affected and what policy says to do.

### Quality/manufacturing engineer

When a production batch underperforms, let me trace the outcome back to the exact design/release evidence and compare relevant changes.

### Auditor/customer/security reviewer

When I need proof, show which design, BOM, firmware, policy, approvals, tool versions, and artifacts produced the release, and let me verify evidence independently.

## Discovery questions

Ask about real incidents, not hypothetical feature interest:

- What was the last release/manufacturing mistake?
- How was it detected?
- How much did it cost in money, schedule, scrap, rework, or reputation?
- Who currently decides “ready to manufacture”?
- Where is that decision recorded?
- How do you know which BOM/firmware/artifacts went with a release?
- What happens when a component becomes NRND/EOL after release?
- Which current step requires spreadsheets/manual review?
- What evidence do customers/auditors/manufacturers request?
- What would prevent you from installing a GitHub App or Action?

See `16-CUSTOMER_DISCOVERY_AND_DESIGN_PARTNERS.md` for the operating program.
