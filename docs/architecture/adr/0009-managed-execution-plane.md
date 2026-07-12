# ADR-0009 — Managed, lease-based execution plane

**Status:** Accepted
**Date:** 2026-07-12
**Issue:** [#149](https://github.com/oaslananka/boardreadyops/issues/149)
**Related:** [#41](https://github.com/oaslananka/boardreadyops/issues/41), [#88](https://github.com/oaslananka/boardreadyops/issues/88)

## Context

The current GitHub App control plane creates an installation token for the
installation that delivered a pull request webhook and uses that token to call
the GitHub Actions workflow-dispatch endpoint in a configured repository. This
is valid when the analyzed repository and dispatch repository are granted to
the same installation, as in the current single-owner production deployment.

It is not a multi-tenant Marketplace execution model. A customer installation
token cannot access an unrelated BoardReadyOps-owned repository, and broader
GitHub App permissions do not change that installation boundary.

BoardReadyOps also has an incomplete self-hosted runner foundation:
installation-scoped runner registrations, identity fingerprints, heartbeat
state, repository allow-lists, execution-attempt records, and a runner-mode
switch exist, but registration-token issuance, signed heartbeat, job claim,
lease renewal, source acquisition, and runner disable APIs are not complete.

A public GitHub App requires an execution plane that:

- works across unrelated customer installations without crossing token scopes;
- keeps the control plane authoritative for tenant and repository selection;
- supports both BoardReadyOps-managed and customer self-hosted workers;
- preserves private-repository, fork, and draft pull-request safety modes;
- binds every result and artifact to one logical run and execution attempt; and
- does not require broad organization, account, administration, or workflow
  permissions.

## Decision

Use a **control-plane queue with short-lived, lease-based job assignment**.
BoardReadyOps-managed workers are the default execution plane for the future
public Marketplace App. Customer self-hosted workers use the same claim,
heartbeat, lease, artifact, and result contracts with stricter
installation/repository eligibility filters.

The existing GitHub Actions dispatch mode remains a compatibility mode for
same-installation deployments. It is not the public multi-tenant default.

## Trust boundaries

### Control plane

The control plane is the only component allowed to:

- map a GitHub installation to tenant data;
- choose the repository, commit, logical run, and current execution attempt;
- decide which worker class is eligible;
- mint job leases and source-access credentials;
- create and complete GitHub Check Runs; and
- accept terminal results and artifact metadata.

Claim and source endpoints never accept a caller-selected installation,
repository, run, or commit as authorization input. Those values come from the
server-side queued attempt selected for the authenticated worker.

### Managed workers

Managed workers authenticate as BoardReadyOps service identities. A managed
worker may claim only the next job assigned by the control plane for its pool
and capabilities. It cannot request a specific tenant or repository.

Managed worker credentials do not grant direct GitHub App administration or
cross-tenant database access.

### Self-hosted workers

Self-hosted workers authenticate with a tenant-scoped runner registration. The
control plane filters claims by:

- installation ownership;
- active registration status;
- heartbeat freshness;
- configured runner label/capabilities;
- optional repository allow-list; and
- repository and pull-request safe-mode policy.

A self-hosted registration cannot claim another installation's work.

## Job and lease model

The `release_run_attempts.id` value is the immutable execution-attempt identity.
A claim creates one opaque lease bound to:

- runner identity;
- logical run ID;
- execution-attempt ID;
- repository ID and exact commit SHA;
- claim timestamp and lease expiry; and
- a random nonce whose plaintext is returned once and whose digest is stored.

Only one non-expired lease may be active for the current attempt. Heartbeats
extend a lease within a bounded maximum runtime. A stale lease may be replaced
only by creating or activating a new attempt according to the existing retry
policy; a late callback from the old attempt is rejected as stale.

The claim response contains no reusable tenant credential.

## Source acquisition

### Managed execution

A managed worker receives an opaque, single-use source ticket for the exact
repository and commit. The source broker:

1. verifies the worker identity and active attempt lease;
2. creates a GitHub App installation token restricted to the exact repository
   and `contents: read` permission;
3. fetches an archive for the exact commit SHA;
4. verifies that the returned source corresponds to the requested immutable
   commit;
5. stages or streams the archive through a short-lived, run-bound object; and
6. destroys the installation token without persisting or exposing it to the
   worker.

GitHub supports narrowing an installation access token to selected repositories
and permissions, and installation tokens expire after one hour. The
BoardReadyOps source ticket and staged object must expire sooner than the
GitHub token.

The source archive is encrypted in transit and at rest, is never placed in a
public bucket, and is deleted under the run-retention policy.

### Self-hosted execution

A self-hosted worker uses customer-controlled checkout credentials or a local
repository mirror. The control plane sends only repository identity, exact
commit SHA, run metadata, and the lease. It does not send a GitHub App
installation token to a customer runner.

## Worker authentication

Runner registrations use asymmetric request signing. The control plane stores
a public-key fingerprint and verification material, never the private key.
Each claim, heartbeat, artifact request, and result callback signs a canonical
message containing:

- HTTP method and normalized path;
- timestamp and unique request nonce;
- runner registration ID;
- run and execution-attempt IDs when assigned;
- lease nonce or lease identifier; and
- SHA-256 digest of the request body.

Requests outside the clock tolerance, duplicate nonces, invalid signatures,
expired leases, or mismatched attempts fail closed. TLS remains mandatory.

GitHub Actions OIDC remains supported only for the compatibility Actions mode.
It is not the managed/self-hosted worker identity mechanism.

## Artifact flow

Workers never receive object-storage master credentials. The control plane
issues short-lived, attempt-bound upload capabilities for declared artifacts.
Every upload is constrained by:

- installation, repository, run, and attempt;
- normalized storage prefix;
- maximum byte count;
- expected media role; and
- optional expected digest.

The result callback may reference only artifacts registered for the same active
attempt. The control plane verifies size and SHA-256 before marking an artifact
available.

## GitHub App permissions

The future managed Marketplace execution profile requires:

| Permission | Level | Purpose |
| --- | --- | --- |
| Metadata | Read | Installation and repository context |
| Pull requests | Read | Supported pull request webhook events |
| Checks | Read and write | Check Run lifecycle |
| Contents | Read | Source broker access to the exact commit |

It does not require Actions permission because dispatch no longer uses a
customer installation token. It requires no organization or account
permissions.

A customer self-hosted profile can omit both Contents and Actions when the
runner uses customer-controlled checkout credentials.

Optional top-level pull request comments remain outside the execution-plane
requirement and use the separately documented Pull requests write or Issues
write permission.

## API surface to implement

The versioned runner API will provide operations equivalent to:

- create and activate a runner registration;
- rotate runner verification keys;
- send a signed heartbeat;
- claim one eligible job;
- renew or relinquish a lease;
- obtain a managed source ticket or self-hosted job descriptor;
- request attempt-bound artifact upload capabilities;
- post progress and terminal result callbacks; and
- disable or revoke a runner registration.

Exact paths and schemas are defined in the contracts package before route
implementation. All mutating operations append audit events.

## Queue and failure behavior

PostgreSQL remains the source of truth for queued attempts and leases. Claiming
uses a transaction and row locking that prevents double assignment. Redis may
be used only as a wake-up or notification optimization; loss of Redis must not
lose or authorize a job.

When no eligible worker is online, the Check Run remains queued and the run
records an operator-visible reason. Bounded retry and timeout transitions move
attempts to `timed_out`, `stale`, or `superseded` without accepting late
terminal output.

## Rollout

1. Define runner protocol contracts, canonical signatures, lease states, and
   audit events.
2. Add database fields/indexes for runner identity, lease digest, expiry,
   claim/heartbeat timestamps, and worker class.
3. Implement self-hosted registration, activation, heartbeat, disable, and
   claim APIs for issue #41.
4. Implement the managed worker service identity and source broker.
5. Add artifact upload capabilities and lease-bound result authentication.
6. Run end-to-end tests with two unrelated GitHub owners/installations.
7. Change the public GitHub App permissions to the managed profile and
   re-authorize test installations.
8. Make managed execution the public default only after the reduced-permission
   validation matrix passes.
9. Retain GitHub Actions dispatch as an explicitly selected compatibility mode.

## Alternatives considered

### Dispatch a BoardReadyOps-owned workflow with the customer installation token

Rejected. Installation tokens cannot cross unrelated installation/repository
boundaries.

### Request broader GitHub App permissions

Rejected. Permissions do not remove installation boundaries and would increase
blast radius without solving dispatch.

### Require every customer to install a workflow

Retained as a compatibility/customer-managed option, but rejected as the
public zero-configuration default.

### Give managed workers unrestricted installation tokens

Rejected. Tokens must be repository- and permission-restricted, and the chosen
source-broker design keeps them out of worker processes entirely.

### Use Redis as the authoritative queue

Rejected. PostgreSQL attempt state, idempotency, and auditability are already
part of the control plane. Redis is optional notification infrastructure only.

## Consequences

### Positive

- Customer installation tokens are never used outside their granted scope.
- The same execution contract supports managed and self-hosted workers.
- Tenant and repository selection remain server-side and auditable.
- Exact-attempt leases extend the existing stale-attempt and replay protections.
- The public App can remove Actions permission when managed execution ships.

### Negative

- Managed execution adds a worker service, source broker, queue/lease APIs, and
  private source-retention responsibilities.
- The public managed profile adds Contents read permission.
- Asymmetric runner identity, nonce storage, lease recovery, and artifact
  capabilities add operational complexity.
- The current GitHub Actions compatibility path must coexist during migration.

## Acceptance criteria

This decision is implemented only when:

- two unrelated GitHub installations can enqueue and complete runs without any
  cross-installation workflow dispatch;
- a managed worker cannot choose or alter tenant/repository assignment;
- source access is exact-repository, exact-commit, short-lived, and audited;
- self-hosted workers cannot claim outside their installation or allow-list;
- duplicate claims, expired leases, stale attempts, replayed signed requests,
  and conflicting terminal results are rejected;
- artifact uploads and result callbacks are bound to the same attempt;
- Check Run create/start/complete succeeds under the reduced managed permission
  profile; and
- security tests demonstrate that no organization/account permission or broad
  installation token is required.
