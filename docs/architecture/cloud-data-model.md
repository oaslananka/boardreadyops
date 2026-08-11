# BoardReadyOps Cloud — Dashboard Data and Artifact Storage Model

**Issue:** [#187](https://github.com/oaslananka/boardreadyops/issues/187)
**Related:** [#188](https://github.com/oaslananka/boardreadyops/issues/188), [#189](https://github.com/oaslananka/boardreadyops/issues/189), [ADR-0008 — Vercel control plane](adr/0008-vercel-control-plane.md), [GitHub App RFC](github-app-rfc.md)

---

## Overview

This document describes the hosted BoardReadyOps dashboard, API, and control-plane persistence model. PostgreSQL SQL migrations under `packages/db/migrations` are authoritative; application stores use parameterized SQL against that versioned schema.

All tables are scoped to a GitHub App `installation_id`. Cross-installation data access is not permitted.

---

## Entities

### Installation

Represents a GitHub App installation on an organization or personal account.

```typescript
interface Installation {
  id: string;                      // internal UUID
  githubInstallationId: number;    // GitHub App installation_id
  accountLogin: string;            // org or user login
  accountType: "Organization" | "User";
  planTier: "free" | "pro" | "team";
  createdAt: Date;
  suspendedAt?: Date;
}
```

### Repository

A repository registered under an installation.

```typescript
interface Repository {
  id: string;
  installationId: string;           // → Installation.id
  githubRepoId: number;
  owner: string;
  name: string;
  private: boolean;
  defaultBranch: string;
  enabledAt: Date;
  disabledAt?: Date;
}
```

### ReleaseRun

One BoardReadyOps check execution on a specific commit.

```typescript
interface ReleaseRun {
  id: string;
  repositoryId: string;             // → Repository.id
  commitSha: string;
  ref: string;                      // branch or tag
  pullRequestNumber?: number;
  triggerKind: "push" | "pr" | "manual" | "workflow_dispatch";
  status: "queued" | "running" | "completed" | "timed_out" | "failed";
  decision: "pass" | "fail" | "error" | null;
  startedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  boardReadyOpsVersion?: string;
  kicadVersion?: string;
  githubCheckRunId?: number;
  // Derived summary counts (denormalized for dashboard queries)
  findingCountError: number;
  findingCountHigh: number;
  findingCountMedium: number;
  findingCountLow: number;
  findingCountInfo: number;
  readinessScore?: number;
}
```

### Finding

Individual rule violation from a release run.

```typescript
interface Finding {
  id: string;
  runId: string;                    // → ReleaseRun.id
  ruleId: string;                   // e.g. "manufacturing.fiducials"
  severity: "error" | "high" | "medium" | "low" | "info";
  message: string;
  path?: string;
  kind?: string;
  waivedAt?: Date;
  waiverId?: string;                // → Waiver.id if waived
}
```

### Artifact

A file included in the release evidence bundle.

```typescript
interface Artifact {
  id: string;
  runId: string;                    // → ReleaseRun.id
  executionAttemptId?: string;      // → ReleaseRunAttempt.id when known
  kind: "gerber" | "drill" | "bom" | "position" | "pdf" | "step" | "report" | "manifest" | "other";
  name: string;                     // display name
  storagePath: string;              // provider-neutral internal locator (not public)
  sha256: string;
  bytes: number;
  role: "fabrication" | "assembly" | "documentation" | "report" | "evidence";
  contentType: string;              // normalized media type, for example application/json
  retentionUntil?: Date;            // optional persisted policy deadline; not an automatic global expiry
  uploadedAt: Date;
}
```

Artifact ownership is not duplicated into the row. Tenant ownership is derived from the authoritative
run → repository → installation relationship. A live artifact row is the durable availability source of
truth; signed-download capability is a separate access concern. Deletion jobs retain bounded operational
outcomes after replaced artifact metadata is removed.

### Waiver

An intentional risk acceptance for a specific finding.

```typescript
interface Waiver {
  id: string;
  repositoryId: string;             // → Repository.id
  ruleId: string;
  reason: string;
  owner: string;                    // email or login of approver
  approvedBy?: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
}
```

### Policy

Stored release policy configuration for a repository.

```typescript
interface Policy {
  id: string;
  repositoryId: string;             // → Repository.id
  configJson: string;               // serialized policy YAML/JSON
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

---


### RunnerRegistration and RunnerJobLease

A customer-hosted runner registration is tenant-scoped through `installationId`. It stores lifecycle state, capability and repository-scope policy, the public verification key, `lastHeartbeatAt`, and the last successfully reported strict `major.minor.patch` agent version. The private signing key and enrollment token are never stored in the control-plane data model.

A valid signed claim poll updates `lastHeartbeatAt` and, when supplied, the reported version even when no job is available. Replay, invalid identity, capability mismatch, and rejected minimum-version requests do not update presence. `RunnerJobLease` remains bound to one release run, current execution attempt, worker identity, bounded expiry, and hashed lease token.

The operator fleet-health read model is computed per installation from aggregate registration presence, self-hosted-policy queue age, active unexpired leases, and version counts. It does not select repository names, source metadata, allowed-repository patterns, key material, fingerprints, or individual runner identifiers.

### WebhookInbox

A minimized, durable record of one verified provider delivery. `(provider, deliveryId)` is unique. It stores routing metadata, the raw-body SHA-256 digest, and bounded normalized lifecycle actions; it never stores webhook signatures, authorization headers, or raw request bodies.

### ControlPlaneJob

A lease-based job referencing exactly one `WebhookInbox` record. Jobs carry an explicit type and payload version, priority, availability time, bounded attempt count, lease owner/expiry, and terminal error metadata. Workers claim available rows using `FOR UPDATE SKIP LOCKED`; expired leases become retryable or dead-lettered at the configured attempt limit.

## Private Artifact Access

Artifacts for private repositories are stored with a non-guessable path prefix and are never served from a public URL.

**Download flow:**

1. Authenticated client calls `GET /api/v1/runs/{runId}/artifacts/{artifactId}/download`
2. API verifies the caller has `read` access to the installation (via GitHub App installation token)
3. API generates a signed URL with a 15-minute TTL pointing to the storage backend
4. Client downloads directly from the signed URL

No artifact binary content passes through the API server on download.

---

## Dashboard Pages and Required Data

| Page | Required entities |
|---|---|
| Repository overview | `Repository`, last 10 `ReleaseRun` (summary) |
| Run detail | `ReleaseRun`, `Finding[]`, `Artifact[]` (manifest) |
| Evidence browser | `Artifact[]` with signed download URLs |
| Waiver management | `Waiver[]`, `Finding[]` (waived) |
| Policy configuration | `Policy`, `ReleaseRun` (simulated) |
| Release history diff | Two `ReleaseRun` records + associated `Finding[]` |

---

## Future Migration Path

The data model is designed to be database-agnostic (no PostgreSQL-specific types in the schema above). Migration considerations:

- **Schema versioning**: additive SQL migrations are recorded in `cloud_schema_migrations`; schema version 39 includes provider-neutral artifact execution-attempt, media-type, and optional retention-deadline metadata; earlier migrations remain additive and ordered.
- **Multi-region**: findings and artifacts are append-only; replication to read replicas is straightforward.
- **Tenant isolation**: all queries filter by `installationId`; adding row-level security (RLS) in PostgreSQL does not require schema changes.
- **Artifact store swap**: `storagePath` is a provider-neutral internal locator. Selecting or migrating an object-storage provider is a separate deployment concern and does not change the artifact metadata contract.
- **Self-hosted**: the data model supports a self-hosted deployment by replacing the GitHub App credentials and storage backend without structural changes.
