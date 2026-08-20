# Customer Discovery and Design Partner Program

## Purpose

Prevent infrastructure/feature progress from being mistaken for product validation.

The goal is to repeatedly observe real release/manufacturing problems, test BoardReadyOps in real repositories, and turn evidence into roadmap/pricing decisions.

## Design partner target

Initial target: **2–5 serious hardware teams** with:

- real boards/products;
- GitHub or compatible Git workflow;
- active releases/manufacturing;
- willingness to install/run BoardReadyOps on representative repositories;
- access to someone who owns release/manufacturing consequences.

Prefer depth over a long waitlist.

## Partner profile record

For each partner record:

- company/team alias if confidentiality requires;
- role(s) interviewed;
- team size;
- EDA/version;
- Git host/workflow;
- number of relevant products/repos;
- manufacturer/CM model;
- current release process;
- current BOM/supplier process;
- last real failure/mistake;
- cost/schedule/rework impact;
- security/data constraints;
- onboarding date;
- enabled repositories;
- protected changes/releases;
- useful findings;
- blockers/feature requests;
- weekly feedback summary;
- willingness-to-pay evidence;
- next validation question.

Do not store secrets/customer source in strategy docs.

## Interview method

### Ask about the past

Good:

- “Walk me through the last board you sent to production.”
- “What was the last issue discovered after ordering?”
- “How did you know which revision/BOM/firmware was correct?”
- “What happened the last time a component changed lifecycle/availability?”

Weak:

- “Would an AI hardware dashboard be useful?”
- “Would you like more rules?”

Past behavior reveals pain; hypothetical preferences produce feature lists.

## Discovery evidence categories

### Problem frequency

How often does the issue occur?

### Severity

What does it cost in money, schedule, scrap, rework, engineer time, customer/audit risk?

### Current workaround

Spreadsheets, manual reviews, scripts, PLM, Slack, tribal knowledge, vendor portals, etc.

### Authority/buyer

Who owns the problem and budget?

### Switching/install friction

What permissions, security review, workflow changes, or EDA constraints block adoption?

### Value event

What exact event makes the user say “BoardReadyOps saved us here”?

## First-value test

For every partner measure:

`Invite/install → enabled repo → first successful run → first understandable finding → first decision influenced`

Record time and friction at each step.

## Weekly partner loop

1. Review actual runs/releases from the week.
2. Ask what BoardReadyOps changed in a decision.
3. Observe confusing/ignored output.
4. Identify one highest-value friction point.
5. Ship/experiment narrowly.
6. Re-run on the same workflow.
7. Record outcome and whether behavior changed.

## Validation experiments by roadmap area

### PR Change Impact

Hypothesis: engineers prefer a concise delta/risk view in PR over navigating a dashboard.

Evidence:

- PR view opened/referenced;
- merge/review decision changed;
- false/noisy findings tracked;
- repeated use across multiple changes.

### Release Passport

Hypothesis: teams need a durable release identity/evidence package.

Evidence:

- used in manufacturer/customer/internal handoff;
- used to answer “what shipped?” later;
- offline verification performed;
- requested by quality/security/customer stakeholders.

### Continuous BOM

Hypothesis: external component changes create enough recurring pain to justify monitoring.

Evidence:

- monitoring kept enabled;
- useful alert acted upon;
- false alert burden acceptable;
- user identifies budget/value.

### Organization Policy

Hypothesis: multi-repo teams will pay to centralize release governance.

Evidence:

- duplicated config is current pain;
- central policy used across multiple repos;
- exceptions/waivers required;
- manager/quality stakeholder consumes portfolio view.

### Manufacturing Feedback

Hypothesis: linking physical outcomes to releases changes engineering decisions.

Evidence:

- customer provides outcome data;
- release mapping succeeds;
- correlation/root-cause workflow used;
- insight changes rule/policy/design.

## Kill/defer rules

- Do not build broad EDA support from one prospect request.
- Do not build full supplier platform if alerts are not acted on.
- Do not build enterprise identity features without a credible buyer/contract pull.
- Do not build full manufacturing integration platform before manual/CSV pilot proves value.
- Do not add AI to a workflow users do not already care about.

## Customer evidence in roadmap

Every major new phase should link at least one of:

- design-partner observation;
- support/request pattern;
- usage metric;
- incident/failure evidence;
- signed commercial requirement.

If none exists, label the phase `EXPLORE` rather than pretending it is committed.

## Confidentiality

Use private CRM/Notion/private issue space for customer-identifying notes where needed. Public repository strategy docs should contain generalized findings only unless explicit permission exists.
