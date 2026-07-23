# Control-plane SLO Alerting Design

## Goal

Turn the existing privacy-safe control-plane SLI snapshot into a versioned GitHub Cloud GA SLO policy that emits bounded alert transitions without tenant content or readiness coupling.

## Policy

The initial policy is `github-cloud-ga-v1`. It evaluates the existing global SLI snapshot only and never reads repository source, findings, payloads, artifact names, credentials, or tenant identifiers.

- Webhook acceptance p95 above 1,000 ms for 5 minutes: warning.
- Lifecycle queue age above 60 seconds for 5 minutes: critical.
- Outbox lag above 60 seconds for 5 minutes: critical.
- Dispatch latency p95 above 30 seconds for 10 minutes: warning.
- Completion latency p95 above 1,800 seconds for 10 minutes: warning.
- Stale attempts above zero for two consecutive snapshots: critical.
- Reconciliation backlog above 20 immediately, or increasing across three snapshots: warning.
- Terminal failure rate above 500 basis points with at least 20 terminal runs in 24 hours: critical.

`reconciliationRepairs24h` remains diagnostic and does not page.

## Evaluator

Add a focused stateful evaluator in `apps/web/lib/control-plane-slo.ts`. It tracks only aggregate signal state in process memory: breach start time, consecutive samples, previous backlog value, and whether an alert is active. The evaluator returns:

- the policy version;
- whether any alert is active;
- the active signal names; and
- transition events for newly firing or recovered alerts.

Repeated breached snapshots do not repeat firing events. A healthy snapshot emits one recovery event for an active signal. A worker restart resets local debounce state; external log/metrics infrastructure remains responsible for durable incident correlation.

## Worker integration

The maintenance loop evaluates each successful SLI snapshot and emits:

- `worker.control_plane_slo_evaluation` at info with policy version, health, and active aggregate signal names;
- `worker.control_plane_slo_firing` at warn for a new alert; and
- `worker.control_plane_slo_recovered` at info for recovery.

A failed SLI query emits the existing `worker.control_plane_sli_failed` event and does not mutate SLO state. SLO evaluation never changes worker readiness or queue processing.

## Testing

Unit tests prove sustained-duration behavior, consecutive-snapshot behavior, backlog trend detection, minimum terminal volume, transition-only emission, recovery, and privacy-safe event shapes. Worker source tests prove the evaluator is wired into successful SLI collection. Documentation tests pin the policy version, events, thresholds, and no-readiness-coupling contract.

## Scope boundary

This slice does not add Check Run drift repair, broad inbox/job drift repair, synthetic target-repository canaries, a dashboard UI, or a durable incident store. Those remain follow-up slices of issue #190.
