# ADR-0015: Enterprise Governance, SSO, SCIM & Data Residency Architectural Blueprint

- **Status:** Proposed / Blueprint (Implementation `planned` upon enterprise customer commitment)
- **Date:** 2026-09-01
- **Relates to:** [ADR-0010 — Target repository execution](0010-target-repository-github-actions-execution.md), [ADR-0014 — Seat-based entitlement tiers](0014-seat-based-entitlement-tier-rename.md)

---

## Context

As BoardReadyOps expands from developer teams to regulated hardware engineering organizations (medical devices, aerospace, automotive, defense), procurement teams require enterprise governance capabilities before adopting cloud-hosted release gates.

These enterprise requirements encompass four core domains:
1. **Identity & Single Sign-On (SAML 2.0 / OIDC)**: Delegated authentication to corporate identity providers (Okta, Microsoft Entra ID, PingIdentity) with mandatory MFA and session enforcement.
2. **Automated User Lifecycle (SCIM 2.0)**: Just-in-Time and automated user provisioning, role synchronization, and instantaneous de-provisioning upon employee offboarding.
3. **Data Residency & Sovereign Isolation**: Tenant-isolated database schemas and blob storage buckets pinned to specific cloud regions (e.g., EU Frankfurt `eu-central-1` vs US Virginia `us-east-1`).
4. **Self-Hosted & Air-Gapped Operation**: Air-gapped container execution without outbound telemetry or external SaaS dependencies.

In accordance with product development principles ("Build Discipline: reuse first, no speculative code without real procurement demand"), we must not prematurely implement speculative enterprise scaffolding. Instead, this ADR establishes the rigorous architectural gap analysis, data contracts, and implementation blueprints so the team can execute rapidly when backed by signed enterprise design partner commitments.

---

## Gap Analysis: Current State vs Enterprise Target

| Enterprise Requirement | Current State (v2.0) | Target Enterprise Architecture |
| :--- | :--- | :--- |
| **Authentication** | GitHub OAuth only (`/api/auth/github/*`). | Dual-mode: GitHub OAuth (developer default) + SAML 2.0 / OIDC enterprise SSO with SP-initiated and IdP-initiated login flows. |
| **User Provisioning** | On-demand creation on first GitHub sign-in. | SCIM 2.0 REST API (`/scim/v2/Users`, `/scim/v2/Groups`) with automated seat allocation and revocation. |
| **Tenant Isolation** | Logical multi-tenancy enforced by foreign keys (`tenant_id`) and Postgres RLS. | Multi-tier isolation: Logical (Community/Team), Dedicated Schema / KMS Customer-Managed Keys (Business/Enterprise), and Single-Tenant VPC Deployment (Self-Hosted). |
| **Data Residency** | Single control plane region with localized storage driver. | Region-aware storage routing (`LocalArtifactStorage` / S3 driver) directing tenant blobs to designated sovereign jurisdictions. |
| **Audit & SIEM** | Append-only database table (`billing_activity`, `audit_log_store`). | High-throughput streaming SIEM export (Splunk, Datadog, AWS S3) with HMAC-signed webhook delivery and durable retry outbox. |

---

## Architectural Blueprint & Technical Design

### 1. Enterprise SSO (SAML 2.0 / OIDC) Architecture

```
┌────────────────────────────────┐         ┌───────────────────────────────┐
│ Corporate Identity Provider    │         │ BoardReadyOps Control Plane   │
│ (Okta / Entra ID / Ping)       │         │                               │
└──────────────┬─────────────────┘         └───────────────┬───────────────┘
               │                                           │
               │  1. SP-Initiated Login (SAML AuthnRequest)│
               │◄──────────────────────────────────────────┤
               │                                           │
               │  2. User Authenticates with MFA           │
               │                                           │
               │  3. Signed SAML Response (Assertion)      │
               ├──────────────────────────────────────────►│
               │                                           │ 4. Verify XML Signature & X.509 cert
               │                                           │ 5. Map SAML Claims (email, groups)
               │                                           │ 6. Issue Session Cookie with Org Scope
```

- **Adapter Abstraction**: Build upon [`packages/cloud-core/src/enterprise/saml-adapter.ts`](file:///C:/Users/Admin/Desktop/PROJECTS/boardreadyops/packages/cloud-core/src/enterprise/saml-adapter.ts).
- **Configuration**: Stored in `enterprise_sso_configurations` table with encrypted IdP metadata XML and X.509 certificate fingerprints.

### 2. SCIM 2.0 User Provisioning Protocol

- Expose `/api/scim/v2/Users` and `/api/scim/v2/Groups` authenticated via tenant-scoped bearer tokens (`SCIM_SECRET_KEY`).
- Map SCIM `active: false` directly to instantaneous session revocation and API token invalidation.
- Synchronize group memberships to BoardReadyOps workspace roles (`viewer`, `reviewer`, `release-lead`, `admin`).

### 3. Sovereign Data Residency Routing

- Store a `storage_region` string in `installations` table (`eu-central-1`, `us-east-1`, `ap-southeast-1`).
- Artifact storage resolver routes upload/download streams to region-pinned storage backends without crossing geographic borders.

---

## Decision & Implementation Guardrail

1. **Keep Status `planned`**: Do not commit unverified runtime code or third-party enterprise SDK dependencies until formal LOI or contract signing.
2. **Preserve Current-State Honesty**: Surface all enterprise features in marketing and documentation matrices strictly as `planned` or `architecture blueprint ready`.
3. **Trigger Criteria for Implementation**: A signed enterprise pilot agreement or LOI requiring SSO/SCIM compliance triggers Phase 1 execution of this blueprint.
