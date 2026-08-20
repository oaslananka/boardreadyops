# AI and Agent Strategy

## Principle

BoardReadyOps should be the **deterministic safety governor and evidence provider for human and agentic hardware workflows**, not an opaque autonomous release authority.

## AI may

- summarize changes/findings;
- explain why a deterministic rule fired;
- prioritize investigation;
- compare current vs historical evidence;
- propose bounded remediation steps;
- translate findings into engineer-friendly language;
- suggest verification commands;
- answer questions over release/evidence history;
- help classify manufacturing failures when evidence supports it.

## AI must not silently

- change PASS/WARN/BLOCK;
- waive policy;
- approve a release;
- rewrite evidence;
- claim a root cause without support;
- auto-modify source outside an explicit bounded workflow;
- hide uncertainty/provider freshness.

## Agent safety opportunity

As coding/hardware agents gain access to EDA/project context, BoardReadyOps can provide a stable contract:

```text
Agent proposes hardware change
        ↓
BoardReadyOps plan/check
        ↓
structured findings + evidence
        ↓
allowed/safe-auto-fix metadata
        ↓
agent changes bounded files
        ↓
verification command
        ↓
BoardReadyOps re-check
        ↓
deterministic PASS/WARN/BLOCK
```

This positions BoardReadyOps as a guardrail around agentic editing rather than a competitor to the agent/EDA itself.

## Grounding requirements

AI responses about a run/release should be grounded in immutable or versioned inputs such as:

- finding IDs/severity/evidence;
- exact release/run identity;
- policy/waiver state;
- artifact metadata/digests;
- supplier observation source/freshness;
- historical release/outcome facts.

The UI should expose citations/links back to those facts.

## Confidence and uncertainty

Where inference is involved:

- label it as inference;
- show missing evidence;
- avoid precise probability unless calibrated;
- distinguish provider uncertainty from model uncertainty;
- provide a deterministic verification path where possible.

## Human-in-the-loop actions

AI can draft:

- waiver request;
- issue/comment;
- supplier-alternate investigation;
- corrective-action hypothesis;
- release summary;
- policy-change proposal.

A human or existing authorized deterministic workflow approves material state changes.

## Data policy

Before commercial AI features:

- define whether customer source/evidence is sent to external model providers;
- minimize payloads;
- document providers/subprocessors;
- provide enterprise controls where needed;
- define retention/training behavior;
- do not silently use customer private data for shared training.

## Evaluation

Evaluate AI on real tasks, not demos:

- finding explanation factuality;
- correct citation to evidence;
- unsupported claim rate;
- remediation usefulness;
- time saved to understand a blocked release;
- rate of unsafe/irrelevant recommendations;
- user acceptance/edit rate.

## Roadmap gate

Significant AI investment comes after users repeatedly consume deterministic findings/evidence. If the underlying evidence workflow is not valuable, an AI layer will not fix the product.

Issue #52 should remain downstream of Cloud GA/trust foundations as current roadmap sequencing specifies.
