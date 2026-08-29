import {
  CURATED_DOC_LINKS,
  DOCS_ORIGIN,
  GLOSSARY_TERMS,
  PUBLIC_CONTENT_LAST_UPDATED,
  PUBLIC_SITE_ORIGIN,
} from "./public-discovery.js";

const productDescription =
  "BoardReadyOps checks whether a KiCad hardware revision is ready to fabricate and keeps the decision tied to the exact Git commit and GitHub evidence that produced it.";

function docsMarkdownUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.origin !== DOCS_ORIGIN) return url;
  if (parsed.pathname === "/") return `${DOCS_ORIGIN}/index.md`;
  return `${DOCS_ORIGIN}${parsed.pathname.replace(/\/$/, "")}.md`;
}

function markdownLinks(): string {
  return CURATED_DOC_LINKS.map((item) => `- [${item.title}](${docsMarkdownUrl(item.url)}): ${item.note}`).join("\n");
}

export function buildSitemapMarkdown(): string {
  return `# BoardReadyOps Sitemap

## Product

- [BoardReadyOps home](${PUBLIC_SITE_ORIGIN}/) — Public product overview and installation entry point.
- [Homepage Markdown](${PUBLIC_SITE_ORIGIN}/index.md) — Machine-readable representation of the product overview.
- [Public OpenAPI](${PUBLIC_SITE_ORIGIN}/openapi.json) — Public liveness and readiness HTTP contract.

## Documentation

${CURATED_DOC_LINKS.map((item) => `- [${item.title}](${item.url}) — ${item.note}`).join("\n")}
`;
}

export function buildLlmsTxt(): string {
  return `# BoardReadyOps

> ${productDescription}

The public website and documentation describe the product and its supported workflows. Authenticated customer data, control-plane operations, runner APIs, billing, tokens, and other private application surfaces are intentionally excluded from public discovery.

## Product

- [Product overview](${PUBLIC_SITE_ORIGIN}/index.md): What BoardReadyOps checks, how exact-commit evaluation works, and how release evidence is presented.

## Documentation

${markdownLinks()}

## API

- [Public OpenAPI](${PUBLIC_SITE_ORIGIN}/openapi.json): OpenAPI 3.1 contract for the public liveness and readiness endpoints only.

## Optional

- [Markdown sitemap](${PUBLIC_SITE_ORIGIN}/sitemap.md): Human- and agent-readable discovery map for the public site.
- [Public agent guidance](${PUBLIC_SITE_ORIGIN}/AGENTS.md): Installation, configuration, and usage orientation for coding agents.
`;
}

export function buildLlmsFullTxt(): string {
  const glossary = GLOSSARY_TERMS.map(([term, definition]) => `- **${term}:** ${definition}`).join("\n");

  return `# BoardReadyOps

> ${productDescription}

BoardReadyOps is release-readiness tooling for KiCad hardware repositories. It is designed for engineering teams that want a repeatable answer to whether a specific board revision is ready for fabrication, without moving repository ownership or manufacturing evidence into a second source of truth.

## How the workflow works

A repository connects through the BoardReadyOps GitHub App. Evaluation is tied to the exact commit being reviewed rather than a moving branch. BoardReadyOps combines KiCad design checks with bill-of-materials, manufacturing-output, policy, and evidence checks, then publishes a release decision with links back to the GitHub run and versioned files that support it.

The product is intentionally evidence-first. A passing result is useful because an engineer can inspect which revision ran, which findings were considered, which outputs were present, and which checksums identify the resulting files. A failing result is useful because the blocking finding remains attached to the source revision that introduced it.

## What BoardReadyOps checks

BoardReadyOps covers layout and schematic rule results, BOM completeness and lifecycle risk, manufacturing package completeness, release metadata, variant consistency, and evidence needed for a fabrication handoff. The detailed rule catalog and configuration options live in the canonical documentation.

${glossary}

## Trust and repository control

The GitHub repository and its workflow history remain authoritative. The public website does not expose authenticated review records, repository-scoped customer data, billing details, access tokens, runner control endpoints, operator interfaces, or webhook ingestion contracts through its discovery documents. Public discovery is deny-by-default: only the marketing homepage, documentation, and explicitly approved health API are described here.

The production GitHub App follows the least-privilege permission model documented in the security guide. Repository source access is not silently broadened for agent discovery or SEO. Search metadata and Markdown mirrors are public information surfaces, not authorization mechanisms.

## Getting started

${markdownLinks()}

For a first installation, start with the Quickstart and GitHub Action documentation. For release decisions, read the report/evidence documentation and the GitHub App permission model before enabling enforcement in a repository.

## Public HTTP API

The machine-readable HTTP contract is available at ${PUBLIC_SITE_ORIGIN}/openapi.json. It intentionally includes only dependency-free liveness and dependency-aware readiness checks. Internal control-plane, authenticated product, runner, billing, webhook, and operator routes are not part of the supported public API.

## Sitemap

See [the Markdown sitemap](${PUBLIC_SITE_ORIGIN}/sitemap.md) for the public product and documentation entry points.
`;
}

export function buildPublicAgentsMarkdown(): string {
  return `# BoardReadyOps public agent guide

BoardReadyOps is a KiCad hardware release-readiness product. Use this file to find the public product and documentation surfaces; it is not a repository-maintainer or production-operations instruction file.

## Installation

Install the BoardReadyOps GitHub App from ${PUBLIC_SITE_ORIGIN}/. The authoritative installation and first-run instructions are in ${DOCS_ORIGIN}/quickstart/.

## Configuration

Repository configuration is documented at ${DOCS_ORIGIN}/configuration/. Keep repository policy and workflow files under the repository's normal review and branch-protection process. Do not infer private installation settings from public discovery documents.

## Usage

Use BoardReadyOps from GitHub pull requests and follow the BoardReadyOps Check Run to the release evidence for the exact evaluated commit. For report formats and evidence semantics, use ${DOCS_ORIGIN}/reports/html/ and the surrounding report documentation.

## Machine-readable entry points

- llms index: ${PUBLIC_SITE_ORIGIN}/llms.txt
- extended context: ${PUBLIC_SITE_ORIGIN}/llms-full.txt
- XML sitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.xml
- Markdown sitemap: ${PUBLIC_SITE_ORIGIN}/sitemap.md
- homepage Markdown: ${PUBLIC_SITE_ORIGIN}/index.md
- public OpenAPI: ${PUBLIC_SITE_ORIGIN}/openapi.json

Authenticated dashboards, customer reviews, billing, tokens, runner endpoints, operator endpoints, webhooks, and other control-plane surfaces are intentionally outside this public discovery contract.
`;
}

export function buildHomeMarkdown(): string {
  const glossary = GLOSSARY_TERMS.map(([term, definition]) => `- **${term}:** ${definition}`).join("\n");

  return `---
title: BoardReadyOps
description: "Checks whether a KiCad board is ready to fabricate on every pull request, with release evidence tied to the exact evaluated commit."
canonical_url: "${PUBLIC_SITE_ORIGIN}/"
last_updated: "${PUBLIC_CONTENT_LAST_UPDATED}"
---

# BoardReadyOps

BoardReadyOps runs hardware release-readiness checks for KiCad repositories and tells reviewers whether the exact pull-request revision is ready to fabricate. The repository remains the source of truth; results link back to the commit, GitHub Check Run, workflow execution, findings, and versioned manufacturing evidence behind the decision.

## What BoardReadyOps checks

BoardReadyOps combines layout and schematic checks with BOM risk, manufacturing-output completeness, release policy, and evidence validation. It is meant to make the release decision inspectable rather than replace KiCad, GitHub, or an existing fabrication-output generator.

${glossary}

## How it fits a pull request

1. Connect the repository through the BoardReadyOps GitHub App.
2. Evaluate the exact commit with repository-owned GitHub Actions execution.
3. Review the verdict first, then follow findings and evidence back to their authoritative GitHub sources.

## Documentation

${CURATED_DOC_LINKS.map((item) => `- [${item.title}](${item.url}): ${item.note}`).join("\n")}

## Public API

The public OpenAPI document at [openapi.json](${PUBLIC_SITE_ORIGIN}/openapi.json) describes only service liveness and readiness. Authenticated and operational APIs are intentionally not public discovery surfaces.

## Sitemap

See the [Markdown sitemap](${PUBLIC_SITE_ORIGIN}/sitemap.md) for public product and documentation entry points.
`;
}

export function buildPublicOpenApiDocument() {
  return {
    openapi: "3.1.0",
    info: {
      title: "BoardReadyOps Public API",
      version: "1.0.0",
      description:
        "Public service liveness and readiness endpoints for BoardReadyOps. Authenticated and operational APIs are intentionally excluded.",
    },
    servers: [{ url: PUBLIC_SITE_ORIGIN }],
    paths: {
      "/api/health/live": {
        get: {
          operationId: "getLiveness",
          summary: "Check service liveness",
          responses: {
            "200": {
              description: "The web service process is live.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    additionalProperties: false,
                    required: ["ok", "service", "check"],
                    properties: {
                      ok: { const: true },
                      service: { const: "boardreadyops-cloud" },
                      check: { const: "liveness" },
                    },
                  },
                },
              },
            },
          },
        },
      },
      "/api/health/ready": {
        get: {
          operationId: "getReadiness",
          summary: "Check service readiness",
          responses: {
            "200": {
              description: "Required configuration and database connectivity are ready.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReadinessSuccess" },
                },
              },
            },
            "503": {
              description: "The service is live but not ready.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/ReadinessFailure" },
                },
              },
            },
          },
        },
      },
    },
    components: {
      schemas: {
        ReadinessSuccess: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "service", "check", "checks", "effectiveConfiguration"],
          properties: {
            ok: { const: true },
            service: { const: "boardreadyops-cloud" },
            check: { const: "readiness" },
            checks: {
              type: "object",
              additionalProperties: false,
              required: ["configuration", "database"],
              properties: {
                configuration: { const: "pass" },
                database: { const: "pass" },
              },
            },
            effectiveConfiguration: {
              type: "object",
              additionalProperties: false,
              required: ["artifactCapabilityTtlSeconds"],
              properties: {
                artifactCapabilityTtlSeconds: { type: "integer", minimum: 1 },
                selfHostedRunnerMinimumVersion: { type: "string", minLength: 1 },
              },
            },
          },
        },
        ReadinessFailure: {
          type: "object",
          additionalProperties: false,
          required: ["ok", "service", "check", "reason"],
          properties: {
            ok: { const: false },
            service: { const: "boardreadyops-cloud" },
            check: { const: "readiness" },
            reason: {
              type: "string",
              enum: ["missing-configuration", "database-unavailable", "database-timeout"],
            },
            missing: { type: "array", items: { type: "string" }, uniqueItems: true },
          },
        },
      },
    },
  } as const;
}
