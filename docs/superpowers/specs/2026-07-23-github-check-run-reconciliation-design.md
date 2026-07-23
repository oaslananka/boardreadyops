# GitHub Check Run Reconciliation Design

## Goal

Converge GitHub Check Run display state after BoardReadyOps has accepted a signed terminal result but GitHub publication did not complete. This is a bounded issue #190 slice; it does not change the accepted release outcome or add synthetic canaries and formal paging SLOs.

## Source of truth

The persisted, signature-verified `release_run_results` row is authoritative. Schema v21 stores the exact GitHub-facing conclusion used by the result route, including neutral outcomes for accepted at-risk results. A compatibility trigger derives the same value for writes from an older web replica during a rolling deployment. Reconciliation may repair GitHub presentation and publication metadata, but it must never infer or replace the release result from GitHub state.

## Candidate detection

Schema v21 detects terminal release runs when:

- a persisted Check Run ID exists;
- the signed terminal result exists;
- `github_check_published_at` is still null; and
- the most recent publication attempt is older than the observation window.

One durable `release_run / reporting_stale` reconciliation item is created with an explicit deadline. Completed or failed reconciliation records prevent repeated candidate creation.

## Safe context

The lease-bound database context contains only tenant/resource IDs, repository owner/name, Check Run ID, run status, the persisted GitHub-facing conclusion, completion timestamp, and deadline. It excludes result payloads, findings, report links, artifacts, source, and credentials.

## Worker flow

1. Claim a tenant-scoped reconciliation lease.
2. Mint a short-lived installation token.
3. Read exactly one Check Run by its persisted ID.
4. If GitHub already reports the expected terminal conclusion, repair only database publication metadata.
5. If the Check Run is pending or has a different conclusion, update it with the expected conclusion and a bounded generic summary derived only from the accepted terminal state.
6. Retry a temporary `404`, lookup failure, or update failure before the deadline.
7. After the deadline, record a stable publication failure without changing release-run status, decision, conclusion, or accepted payload.
8. Complete the reconciliation item and append a content-free audit event atomically.

## Stable outcomes

- `github_check_run_reconciled`: GitHub was already current or was updated successfully.
- `github_check_run_not_found`: the persisted Check Run remained missing through the deadline.
- `github_check_run_lookup_failed`: authoritative lookup remained unavailable through the deadline.
- `github_check_run_update_failed`: GitHub remained reachable but the terminal update could not converge.
- `context_stale`: publication completed or the target changed before the leased worker applied its observation.

## Privacy and security

GitHub response bodies are never returned from the observation client or written to logs. Installation tokens remain in memory only. Recovery summaries contain no findings or tenant payload content. Every database mutation requires the active reconciliation lease and the original terminal result row.
