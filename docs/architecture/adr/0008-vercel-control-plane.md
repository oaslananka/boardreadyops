# ADR-0008 — Vercel as BoardReadyOps Cloud Control Plane

**Status:** Superseded — the project deployed a self-hosted Docker/Compose control plane instead; see [Self-hosted deployment](../../deployment/self-hosted.md)
**Date:** 2026-06-27
**Issue:** [#304](https://github.com/oaslananka/boardreadyops/issues/304)

## Context

BoardReadyOps v2 includes a hosted cloud tier that surfaces release history, evidence bundles, and dashboards for teams using the GitHub App. This tier requires:

- A web dashboard (Next.js or similar)
- A GitHub App webhook endpoint (receives `check_suite`, `check_run`, `pull_request` events)
- A REST/GraphQL API consumed by the dashboard and CLI
- Storage for structured release data (runs, findings, manifests, waivers, policies)
- Storage for binary build artifacts (Gerbers, BOMs, evidence bundles)
- A background execution plane for `kicad-cli`-heavy generation jobs

## Decision

Use **Vercel** for the web dashboard, API routes, and GitHub App webhook handler (the "control plane"). Heavy KiCad/generation jobs run in a separate execution plane (GitHub Actions runners or dedicated workers) and push results back to the API.

## Control Plane on Vercel

Vercel is suitable for the control plane because:

1. **Serverless functions** handle webhook events and API requests with automatic scaling and no infrastructure management.
2. **Edge network** delivers the dashboard globally with low latency.
3. **GitHub App integration** is straightforward: webhook endpoints are standard HTTP routes deployed as serverless functions.
4. **Managed deployment** from the monorepo eliminates ops overhead during early development.
5. **Cold start** latency is acceptable for webhook handlers (GitHub retries with back-off).

### Proposed monorepo layout

```
boardreadyops/                 ← root (existing CLI + GitHub Action)
├── apps/
│   ├── web/                   ← Next.js dashboard (Vercel deployment target)
│   │   ├── app/               ← App Router pages and API routes
│   │   │   ├── api/
│   │   │   │   ├── github/    ← GitHub App webhook handler
│   │   │   │   └── v1/        ← REST API consumed by CLI and dashboard
│   │   │   └── dashboard/     ← Web dashboard pages
│   │   └── vercel.json
│   └── container/             ← existing KiCad container (unchanged)
├── packages/
│   ├── plugin-sdk/            ← existing SDK (unchanged)
│   └── db/                    ← Prisma schema and generated client (new)
├── src/                       ← existing CLI/Action source (unchanged)
└── ...
```

## Execution Plane (not Vercel)

`kicad-cli` is a ~200 MB binary with 30–120 second jobs. Vercel serverless functions have a 300-second maximum and are not suitable for:

- Running `kicad-cli` generation
- Processing large Gerber/BOM artifact archives
- Long-running validation pipelines

These jobs run in:
- **GitHub Actions** (default): the existing GitHub Action already handles this. The cloud tier triggers an Actions workflow dispatch and polls for results, or the Action pushes results to the API via an authenticated call.
- **Dedicated workers** (future): a separate worker pool (Railway, Fly.io, AWS ECS) for non-GitHub-hosted boards.

The API boundary between the control plane and execution plane is: a signed job request in, a signed result POST back to the API route.

## Database and Storage

| Need | Recommendation | Reason |
|---|---|---|
| Structured data (runs, findings, waivers, policies) | **Neon** (PostgreSQL, serverless) | Vercel-native integration, branching for preview deployments |
| Binary artifact storage | **Vercel Blob** or **Cloudflare R2** | Vercel Blob for MVP simplicity; R2 for cost at scale |
| Job queue (future) | **Upstash Redis** or **Inngest** | Vercel-compatible, no infrastructure ops |

### Private artifact access

Evidence bundles for private repositories must not be publicly accessible.

- Artifacts are stored with a randomised path prefix (not guessable).
- Signed download URLs are generated per-request with a short TTL (15 minutes).
- The API validates GitHub App installation membership before issuing a signed URL.
- No artifact is served directly from a public CDN URL.

## Security

- Webhook payloads are verified with `HMAC-SHA256` using the GitHub App webhook secret before any processing.
- Database rows are scoped to `installation_id` so one tenant cannot read another's data.
- The GitHub App requests the minimum required permissions (see the GitHub App RFC).
- API routes authenticate via GitHub App installation tokens, not user OAuth tokens, so no user credentials are stored.

## Consequences

**Positive**
- No infrastructure to manage during early development.
- Preview deployments per PR make it easy to test webhook handling changes.
- Vercel Blob + Neon integrate without additional ops.

**Negative / Risk**
- Vercel vendor lock-in for the control plane. Mitigation: the API layer is Next.js App Router (portable), and the database is standard PostgreSQL.
- Serverless cold starts add latency to low-traffic webhook handlers. Mitigation: acceptable because GitHub retries.
- Large artifact uploads may hit Vercel Blob request limits at scale. Mitigation: R2 swap is straightforward.
