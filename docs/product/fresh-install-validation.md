# Fresh GitHub App install-to-first-useful-finding validation

Issue: [#446](https://github.com/oaslananka/boardreadyops/issues/446)

This protocol defines **external acceptance evidence**, not a claim that onboarding has been validated. A successful local `boardreadyops check`, a passing setup probe, or a workflow queued without findings **does not** establish Time to First Useful Finding (TTFUF).

## Test prerequisites

Use two freshly created, representative repositories, with no BoardReadyOps workflow, config, or pre-existing GitHub App installation selection. One must deliberately contain an actionable manufacturing or BOM finding in a test board; the other tests a no-finding run so that a passing empty result cannot produce a false activation measurement. Do not copy customer designs into demo repositories.

Record the repository's public-safe identifier, UTC start timestamp, source commit SHA, workflow and config SHA, GitHub App permissions review, and the versions of the CLI, workflow template and KiCad. Use unique installations or disjoint test repositories to avoid warm-cache results. For private repositories, record references in private internal notes only.

## Instrument the entire path

1. **Start (T0)** — Record the owner's initial installation/selection action as a UTC timestamp, before the App is installed or any setup is requested. Save the GitHub installation event reference without tokens.
2. **Setup** — Review the App permissions, select the fresh repository, choose a preset, inspect the exact workflow/configuration and approve only the required setup PR. Record setup diagnostics for missing workflow, disabled Actions and incompatible configuration.
3. **Run** — Create a representative PR; record the PR head SHA, event/dispatch reference, generated run ID, check-run URL, and GitHub Actions workflow run URL. Confirm the executed commit equals the authorized head SHA. A queued/started/check-run-created event is not success.
4. **First useful finding (T1)** — Require a persisted, normalized *actionable* non-empty finding whose rule, affected hardware scope and remediation are visible to the reviewer in the native Check Run, with a matching hosted run link. Record its first visible timestamp. An empty PASS, setup probe, synthetic placeholder, or status-only event does **not** qualify.
5. **Measure** — Compute `TTFUF = T1 - T0` in wall-clock seconds, including GitHub installation, workflow approval, queue time and execution. Keep each test's T0 and T1, not only an average. Mark a run **incomplete**, not 0 seconds, if no useful finding appears.
6. **Negative path** — Validate the clean control repository shows an honest PASS/no useful finding; record its run completion separately. Induce at least one missing-workflow and permission-denied condition in a disposable test repository, and verify that owner-facing diagnostics identify the repair action without leaking credentials or design content.

## Acceptance record

| Field | Evidence required |
| --- | --- |
| Setup and scope | Fresh repo/installation ID, account type, preset, permission grant review, setup PR link |
| Reproducible execution | Initial repository SHA, PR head SHA, configured workflow SHA, KiCad/CLI version, Actions URL |
| First useful signal | Normalized finding category/severity, check-run URL, hosted result URL, remediation visible |
| Latency | T0 (UTC), T1 (UTC), TTFUF (seconds); missing T1 marked incomplete |
| Privacy and safety | No repository source/board contents in hosted telemetry; callback is OIDC-bound, source stays in target Actions |
| Failure classification | Explicit status for missing workflow, Actions disabled, mismatched permissions, setup error, or empty/pass-only result |

Initial acceptance target in [#446](https://github.com/oaslananka/boardreadyops/issues/446): **under 10 minutes**, with a later optimization goal **under 5 minutes**. The stricter metric in [product metrics](../gtm/product-metrics-and-telemetry.md) is a future exit gate, not current measured performance. Preserve actual failed attempts; do not report only the fastest successful run.

## Completion boundary

Close #446 only after the entire fresh-install sequence can be repeated without developer intervention and the linked evidence establishes the end-to-end timing and expected failure diagnostics. This protocol by itself satisfies **documentation of the measurement procedure**, not product acceptance.
