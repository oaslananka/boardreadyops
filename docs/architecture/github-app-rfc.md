# RFC: BoardReadyOps GitHub App architecture

**Status:** Implemented for the current single-owner deployment; public
Marketplace execution remains incomplete.

**Security review:** [GitHub App permissions and webhook subscriptions](../security/github-app-permissions.md)

**Execution decision:** [ADR-0009 — Managed, lease-based execution plane](adr/0009-managed-execution-plane.md)

**Tracking issue:** [#88](https://github.com/oaslananka/boardreadyops/issues/88)

## Summary

The BoardReadyOps GitHub App receives installation and pull request webhooks,
creates a native Check Run, dispatches work to an execution plane, accepts a
signed runner result, and completes the Check Run with a link to the hosted run
dashboard.

The current production implementation is intentionally narrower than the early
proposal:

- the `pull_request` webhook is the only manually selected repository event;
- `installation` and `installation_repositories` are received automatically;
- Check Runs are the authoritative GitHub result surface;
- a top-level pull request summary comment is optional and non-blocking;
- commit statuses are not used; and
- `check_suite` and `check_run` re-request events are not currently handled.

## GitHub App and GitHub Action roles

| Concern | GitHub Action | GitHub App control plane |
| --- | --- | --- |
| Installation | Repository adds a workflow | Repository owner installs the App |
| Trigger | Workflow event | Signed GitHub App webhook |
| Execution | Job-scoped runner token | Configured execution plane |
| Result display | Workflow annotations and artifacts | Native Check Run and hosted dashboard |
| Authentication | `GITHUB_TOKEN` and optional OIDC | Installation token, webhook HMAC, and runner identity |

The App complements the Action. It does not grant its installation token to the
runner and does not use broad repository permissions as a substitute for a
proper execution-plane trust boundary.

## Required permissions

The authoritative permission matrix is maintained in
[GitHub App permissions and webhook subscriptions](../security/github-app-permissions.md).

For the current GitHub Actions dispatch profile, the minimum repository
permissions are:

| Permission | Level | Reason |
| --- | --- | --- |
| Metadata | Read | GitHub-required repository and installation context |
| Pull requests | Read | Receive `pull_request` events |
| Checks | Read and write | Create, start, and complete Check Runs |
| Actions | Read and write | Dispatch the configured runner workflow |

The future managed Marketplace profile replaces Actions access with Contents
read for the source broker. Customer self-hosted execution can omit both when
it uses customer-controlled checkout credentials. The profile must match the
execution mode that is actually deployed.

Pull request summary comments require either Pull requests write or Issues
write. They are not required for the readiness decision and must not expand the
public App's permission surface unless the feature is intentionally enabled.

No organization or account permissions are required by the shipped control
plane or the accepted managed execution design.

## Webhook events

The service accepts:

| Event | Action(s) | Result |
| --- | --- | --- |
| `ping` | n/a | Verify webhook connectivity |
| `installation` | lifecycle actions including create and delete | Upsert or remove installation and repository records |
| `installation_repositories` | `added`, `removed` | Update the installation repository set |
| `pull_request` | `opened`, `reopened`, `synchronize`, `ready_for_review` | Enqueue a release run |

Other pull request actions are accepted as no-ops. Unsupported event types are
rejected by the normalizer and are not part of the subscription profile.

## Check Run lifecycle

```text
pull request event
        |
        v
verify webhook HMAC and normalize payload
        |
        v
persist installation/repository/run state
        |
        v
create Check Run (queued)
        |
        v
dispatch execution attempt
        |
        v
mark Check Run in progress
        |
        v
runner posts authenticated, versioned result
        |
        v
persist result/findings/artifacts atomically
        |
        v
complete Check Run and link hosted dashboard
        |
        v
optionally upsert top-level PR summary comment
```

Check Run publication is required. If it cannot be completed, the callback
returns a retriable error after persisting the result. Pull request comment
publication is optional: failures are retained in publication audit state but
do not turn a successful runner callback into a failure.

## Pull request safety modes

The webhook normalizer records whether a pull request is:

- a draft;
- from a fork; or
- in a private repository.

The execution dispatch includes the normalized safety mode and reasons. Draft
and fork pull requests are not dispatched by the current lifecycle executor.
Private-repository execution remains explicitly marked for safe-mode handling.

## Authentication and storage boundaries

- Every incoming webhook is verified with HMAC-SHA256 before JSON processing.
- GitHub App installation tokens are created on demand, expire according to
  GitHub policy, and are not persisted.
- GitHub Actions callbacks use OIDC bound to the logical run and current
  execution-attempt ID in hardened compatibility mode.
- Managed and self-hosted workers use the asymmetric, lease-bound runner
  identity defined by ADR-0009.
- Exact terminal result replay is accepted; stale attempts, superseded commits,
  and conflicting terminal payloads are rejected.
- Findings, result metadata, publication state, and audit events are persisted
  in PostgreSQL.
- Artifact downloads use a separate signing key and short-lived, run-bound
  URLs.

## Execution-plane decision

The current `github-actions` mode obtains an installation token for the App
installation that received the pull request, then dispatches a workflow in the
configured runner repository. That token can access only repositories granted
to the same installation.

This is valid for the current single-owner deployment. It is not a complete
zero-configuration multi-tenant Marketplace execution plane because a customer
installation token cannot dispatch a workflow in an unrelated
BoardReadyOps-owned installation.

ADR-0009 accepts a control-plane queue with short-lived leases:

1. BoardReadyOps-managed workers become the future public Marketplace default.
2. A source broker uses an exact-repository, contents-read installation token
   without exposing the token to worker processes.
3. Customer self-hosted workers use the same claim, heartbeat, lease, artifact,
   and result contracts under installation/repository eligibility filters.
4. GitHub Actions dispatch remains an explicitly selected, same-installation
   compatibility mode.

The public App must not request broader repository, organization, or account
permissions to bypass the installation boundary.

## Public-launch completion criteria

The GitHub App is ready for public Marketplace distribution only when:

- the external production/public App settings match the least-privilege profile;
- broad development permissions and unrelated webhook subscriptions are removed;
- the ADR-0009 managed execution and source-broker design is implemented and
  threat modeled;
- two unrelated installations pass claim, source, artifact, result, and tenant
  isolation tests;
- installation, repository lifecycle, pull request, Check Run, runner callback,
  and optional comment flows pass end to end with the reduced permissions; and
- issue #88 records the final settings review and validation evidence.
