# Weekly and Monthly Operating Review

Use this template to keep strategy connected to delivery and customer evidence.

Do not append every review forever to this file. Copy the template into the appropriate private/team operating system or a dated review record. Keep only durable generalized conclusions in the public strategy docs.

## Weekly Execution Review

### Header

```text
Week:
Current phase:
Current release/deployment:
Single most important outcome this week:
Reviewer/owner roles:
```

### 1. Shipped with evidence

For each completed item:

- issue/PR;
- user/operational outcome;
- test/evidence link;
- metric expected to change.

### 2. Current blockers

For each blocker:

- issue/risk ID;
- why it blocks current phase;
- owner;
- evidence needed to unblock;
- next concrete action.

### 3. #191 alignment

- Did current delivery order change?
- Did an issue move to an earlier/later dependency phase?
- Are completed historical milestones still correctly closed?
- Did a security/release-health regression create a new promotion blocker?

If yes, update the authoritative issue first, then this summary.

### 4. User/customer learning

Record generalized evidence:

- interviews completed;
- external repos activated;
- useful findings;
- confusing/noisy findings;
- release decisions influenced;
- feature requests tied to real incidents;
- willingness-to-pay evidence.

### 5. Metrics

Review only a small useful set:

- Protected Hardware Changes / Month trend;
- weekly active/retained external repos;
- activation/time-to-first-value;
- reliability errors/backlog;
- design-partner status.

### 6. Risks

- Did a risk probability/impact change?
- New risk?
- Is a mitigation unproven?
- Any public strategy/customer confidentiality issue?

Update `18-RISK_REGISTER.md` if durable.

### 7. Decisions needed

List decisions where implementation is currently making an implicit choice. Add them to `19-DECISION_LOG.md` before coding around ambiguity.

### 8. Stop / Start / Continue

- **Stop:** work that lacks evidence or violates sequencing.
- **Start:** the smallest next outcome that removes the main blocker.
- **Continue:** work whose evidence remains strong.

### 9. Next week

Choose one primary outcome and at most a few supporting outcomes.

```text
Primary outcome:
Evidence that proves it:
Dependencies:
What will NOT be worked on:
```

---

# Monthly Strategy Review

## 1. Product thesis check

Ask:

- Are users treating BoardReadyOps as release trust or merely another linter?
- Is PR/release workflow still the right wedge?
- Which part of the product created the strongest real value event?
- Is the dashboard becoming a destination without workflow value?

## 2. ICP check

- Which team profiles activate fastest?
- Which have highest repeated use/pain?
- Who owns budget?
- Are enterprise requests real contracts or speculative feature pull?

Update ICP only from repeated evidence.

## 3. Roadmap check

For every NEXT/LATER phase:

- what evidence says this should exist?
- what prerequisite is incomplete?
- can it be solved by integration instead of new platform capability?
- should it move to `EXPLORE`/`NOT NOW`?

Kill/defer aggressively.

## 4. Competition / ecosystem / standards

Review meaningful changes in:

- hardware collaboration/release tools;
- EDA/agent workflows;
- supplier/BOM intelligence;
- GitHub platform behavior;
- CycloneDX/hardware BOM standards;
- regulatory requirements relevant to release evidence.

Record only changes that alter a decision, risk, or experiment.

## 5. OSS / Cloud health

- Is local OSS value still strong?
- Is Cloud creating continuity/history/monitoring value rather than paywall friction?
- Is license/repo boundary becoming painful?
- Are public contributions/community signals healthy?

## 6. Trust/security review

- Any permission/data-boundary drift?
- Are restore/isolation/security exercises current?
- Does product copy still match deployment?
- Any new high-impact dependency/platform risk?

## 7. Economics

When data exists:

- supplier-data COGS;
- storage/compute costs;
- support burden;
- pricing objections;
- value metric fit;
- design-partner → paid evidence.

## 8. Moat check

Ask:

> Did this month strengthen workflow trust/history/outcome learning, or merely increase system complexity?

Strong moat signals:

- more retained protected repositories;
- more verified release history;
- useful cross-product impact mapping;
- manufacturing outcome linkage;
- users relying on evidence in real decisions.

## 9. Update artifacts

Only when evidence changed:

- `00-MASTER_PLAN.md` current phase/state;
- `08-PRODUCT_ROADMAP.md` phase status;
- `17-METRICS.md` definitions (rarely; avoid changing definitions casually);
- `18-RISK_REGISTER.md`;
- `19-DECISION_LOG.md`;
- `21-NOT_NOW_AND_TRIGGERS.md`.

## 10. Monthly decision summary

```text
Month:
What we learned:
What changed in strategy:
What we stopped:
What we will validate next:
Top risk:
Top customer evidence:
Top technical evidence:
```
