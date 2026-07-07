# Release run lifecycle

Issue: #23

## Goal

BoardReadyOps should handle duplicate, superseded, retried, cancelled, and timed-out runs predictably for GitHub App readiness checks.

## Lifecycle states

| State | Meaning | Terminal |
| --- | --- | --- |
| queued | Run was accepted and stored before workflow dispatch. | No |
| dispatched | Workflow dispatch was requested. | No |
| running | Runner started and has not reported a terminal result yet. | No |
| completed | Runner finished successfully and produced a decision. | Yes |
| failed | Runner failed or reported an error decision. | Yes |
| timed_out | Runner exceeded its allowed time window. | Yes |
| cancelled | Run was intentionally cancelled because it no longer applies. | Yes |
| superseded | A newer run replaced this run for the same PR/ref. | Yes |

## Idempotency policy

- The natural idempotency key is repository id, pull request number, and commit SHA.
- Re-delivery of the same webhook must return the existing run instead of creating a duplicate.
- A new commit on the same PR should create a new run and mark earlier non-terminal runs for that PR as superseded.
- A manual retry should create a new run attempt only when the previous run is terminal.

## Check-run policy

- Duplicate webhook delivery should not create duplicate check runs.
- Superseded runs should complete their check run as neutral with a clear summary.
- Cancelled runs should complete their check run as neutral.
- Timed-out runs should complete their check run as timed_out.

## Runner callback policy

- Runner callbacks are accepted only for known run ids.
- Terminal run states should not be overwritten by late callbacks unless an explicit retry id matches.
- Late callbacks from superseded runs should be recorded for audit but must not update the active PR decision.

## Timeout policy

- The hosted app should maintain a timeout job or endpoint that marks stale dispatched/running runs as timed_out.
- Timeout threshold should be configurable per installation or deployment.
- Default timeout should be conservative enough for KiCad generation and report upload.

## Acceptance criteria

- Duplicate webhook deliveries are idempotent.
- New PR commits supersede older non-terminal runs for the same PR.
- Late callbacks cannot reverse a newer decision.
- Timed-out and cancelled runs complete GitHub check runs consistently.
- The hosted dashboard shows superseded/cancelled/timed-out states clearly.
