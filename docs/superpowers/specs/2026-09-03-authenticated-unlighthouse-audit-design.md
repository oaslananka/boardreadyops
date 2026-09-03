# Authenticated Unlighthouse Audit Design

## Goal

Add a safe authenticated Unlighthouse audit path for the production BoardReadyOps UI so the real dashboard, repository, run-investigation, review, and settings surfaces are measured rather than only public pages.

## Current state

The repository currently uses Lighthouse CI through `.github/workflows/lighthouse.yml` and `.lighthouserc.json`. That job builds the web app locally and audits `/`, `/setup`, and `/reviews`; it does not exercise a signed-in production session or dynamic tenant routes.

BoardReadyOps browser authentication is a signed `brops_session` cookie. The cookie is HttpOnly, Secure, SameSite=Lax, and short-lived, so the audit must accept it as an ephemeral runtime secret rather than persist it in repository files.

## Design

Use `@unlighthouse/core@0.18.0` as a pinned dev dependency. The aggregate `unlighthouse` package is intentionally not installed because its transitive graph violates the repository's provenance no-downgrade policy. `unlighthouse.auth.config.ts` reads `BROPS_SESSION`, the target site, and a generated authenticated route manifest. The programmatic core worker injects the cookie into Puppeteer, disables storage reset between page scans, uses one browser worker, and produces a static report under an ignored `.unlighthouse/` directory.

A Node orchestration script will discover representative signed-in routes before invoking the programmatic Unlighthouse worker. Discovery will request a small set of server-rendered authenticated seed pages with the cookie, extract same-origin links, accept only BoardReadyOps product route families, and synthesize the full run-investigation sub-route set for one discovered run.
## Route policy

Always include `/dashboard`, `/reviews`, `/settings/billing`, `/settings/component-intelligence`, `/settings/data`, `/settings/security`, and `/settings/tokens` when they are reachable. Dynamic discovery may include only:

- `/repositories/<id>`
- `/reviews/<id>`
- `/runs/<id>`
- `/runs/<id>/findings`
- `/runs/<id>/artifacts`
- `/runs/<id>/attempts`
- `/runs/<id>/audit`
- `/runs/<id>/publication`

Only one representative identifier per dynamic family is needed for the default audit. Query strings and fragments are removed. Cross-origin links, auth endpoints, mutation endpoints, downloads, and arbitrary discovered paths are rejected.

The route manifest is safe to persist because it contains only same-origin paths, timestamps, and the target origin. It must not contain cookies, headers, HTML bodies, API tokens, installation credentials, or user profile payloads.

## Authentication failure behavior

The discovery step must fail closed when `BROPS_SESSION` is absent, empty, redirected to the GitHub login flow, or unable to load the authenticated dashboard. It must never silently fall back to an anonymous scan.

Errors may identify the failing route and HTTP status, but must never print the session value or a raw Cookie header.
## CI and developer operation

Local operation uses `BROPS_SESSION` from the shell environment and a package script. A debug variant may run the browser headfully for authentication troubleshooting, but it still consumes the cookie from the environment and never writes it to disk.

Add a separate `workflow_dispatch` GitHub Actions workflow for authenticated production audits. It will have `contents: read` only, run on `main`, use a repository/environment secret named `BROPS_UNLIGHTHOUSE_SESSION`, upload the static report as an artifact, and never run on pull-request code or on a schedule. The session secret is intentionally external state and may expire; the workflow must report that condition clearly rather than weakening authentication.

Existing public Lighthouse CI remains authoritative for unauthenticated public-route budgets. The authenticated Unlighthouse workflow complements it; it does not replace or relax existing gates.

## Budgets

Use conservative initial signed-in budgets so the first production baseline is actionable rather than aspirational:

- accessibility: 90
- performance: 70
- best-practices: 85
- SEO: omitted for authenticated product pages

The authenticated audit scans performance, accessibility, and best-practices only. Budgets may be tightened later from measured baselines, but this change does not lower existing public Lighthouse thresholds.

## Testing

Unit tests cover route extraction, allowlisting, representative sampling, synthesized run subroutes, missing/invalid session failure, redirect-to-login failure, manifest writing, and secret redaction. A workflow contract test verifies read-only permissions, manual-only triggering, pinned actions, secret wiring, artifact upload, and absence of pull-request/schedule triggers.
## Security constraints and non-goals

This work does not automate GitHub credentials, store a long-lived user password, mint privileged sessions from the production signing secret, broaden GitHub App permissions, or expose an authenticated report publicly. It does not add the ephemeral session to `.env`, source control, logs, route manifests, or uploaded artifacts.

The workflow cannot become fully unattended until BoardReadyOps has a dedicated audit identity/session mechanism whose lifecycle is explicitly designed. Until then, refreshing `BROPS_UNLIGHTHOUSE_SESSION` is an external credential operation, not something repository code should fake.

## Completion criteria

The change is complete when the pinned Unlighthouse dependency, authenticated config, discovery/orchestration scripts, ignored output paths, documentation, tests, and manual workflow all pass repository verification; a synthetic authenticated fixture proves the cookie path without leaking the secret; and the PR is green through the normal Mergify queue.

A real production scan is an additional runtime verification step that requires a currently valid `brops_session`. If no valid session is available to the automation environment, the implementation remains mergeable because the auth protocol itself is covered by deterministic tests, but production scan evidence must be reported as externally blocked rather than fabricated.

## Runtime compatibility notes

Unlighthouse 0.18.0 can requeue an authenticated Lighthouse navigation after an initial login interstitial. Completion therefore waits for terminal reports for every expected route plus a completed worker monitor state instead of relying solely on the `worker-finished` hook.

Unlighthouse also replaces the underlying `puppeteer-cluster` display object with a no-op object that lacks `close()`. The wrapper clears only that incomplete display shim before calling the normal cluster close path. No patch is applied to installed dependencies.
