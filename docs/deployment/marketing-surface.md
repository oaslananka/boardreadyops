# Optional independently deployed marketing surface

The control-plane deployment remains the authoritative SaaS application. A
single, reviewed BoardReadyOps web runtime image can **also** run as a small
separate, public-only marketing container. This does not create a second
frontend codebase or require a new hosted vendor.

This is an **opt-in deployment mode**. The current production hostname and
ingress are unchanged until an operator explicitly commissions a separate
marketing origin. The deployment can start, stop, be upgraded or rolled back
without restarting the SaaS web, worker, PostgreSQL or Redis services.

## Runtime boundary

Set `BOARDREADYOPS_SITE_SURFACE=marketing` in the marketing container only.
This mode exposes the marketing homepage and public discovery files, the
immutable `/_next/static/` assets, public demo files, and a basic liveness
route. It returns HTTP 404 for other paths, including OAuth, webhooks,
`/api/v1/*`, hosted runs, dashboard, billing and repository APIs. Non-read
requests are denied. Do not give this container a production `.env`, database
connection, GitHub private key, OAuth secret, artifact volume or worker.

Existing SaaS remains in the default `app` mode. Its sessions, API and OAuth
behavior are unchanged. The marketing homepage intentionally stays signed
out; customer actions such as `/setup` link to the configured SaaS origin
(default `https://boardreadyops.com`). The optional marketing origin can be
a different hostname without needing to duplicate authentication state.

## Independent release and verification

Build and validate the existing `apps/web/Dockerfile` runtime image via the
normal protected repo/CI process, then use a reviewed, locally available
immutable source-SHA image tag:

```sh
export BOARDREADYOPS_MARKETING_IMAGE_TAG=<reviewed-commit-sha>
export BOARDREADYOPS_MARKETING_APP_ORIGIN=https://boardreadyops.com
docker compose -f deploy/docker-compose.marketing.yml config --quiet
docker compose -f deploy/docker-compose.marketing.yml up -d marketing
```

This Compose project is separate from the SaaS Compose project and publishes
only to **127.0.0.1:3002** by default. There is no new production ingress,
DNS record or additional always-running service until specifically configured.
To expose a public marketing domain, the operator must separately set up HTTPS
ingress to that local listener; retain the original SaaS origin for OAuth and
all customer routes. Deploy, inspect and roll back the marketing container
independently by pinning a different known-good `BOARDREADYOPS_MARKETING_IMAGE_TAG`;
do not couple it to the control-plane `BOARDREADYOPS_IMAGE_TAG`.

Expected smoke behavior on the marketing listener: `GET /` and
`GET /api/health/live` return 200; `GET /setup`, `GET /api/v1/runs`,
`POST /api/v1/runs`, `GET /api/auth/github/login`, and
`GET /openapi.json` return 404. The public homepage links to the actual
BoardReadyOps GitHub App PASS/BLOCK pull requests and to the SaaS setup page.
Marketing-only route filtering is **not** a replacement for SaaS authorization.

This option establishes *independent deployability* but not proof of a
separately commissioned production hostname, a final DNS cutover, an actual
customer manufacturing release, or a dedicated independently built static
marketing artifact. Record such acceptance only after verifying it in the
chosen deployed environment.
