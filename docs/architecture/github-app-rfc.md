# RFC: BoardReadyOps GitHub App architecture

**Status:** Target-repository GitHub Actions is the hosted default; customer
self-hosted execution remains optional.

**Security review:** [GitHub App permissions and webhook subscriptions](../security/github-app-permissions.md)

**Execution decision:** [ADR-0010 — Target-repository GitHub Actions execution](adr/0010-target-repository-github-actions-execution.md)

**Optional self-hosted protocol:** [ADR-0009 — Managed, lease-based execution plane](adr/0009-managed-execution-plane.md)

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
| Execution | Target repository GitHub-hosted runner | Dispatch and result coordination |
| Result display | Workflow annotations and artifacts | Native Check Run and hosted dashboard |
| Authentication | `GITHUB_TOKEN` and optional OIDC | Installation token, webhook HMAC, and runner identity |

The App complements the Action. It dispatches a reviewed workflow in the target
repository and never grants its installation token to the runner. The workflow
uses its own job-scoped token for exact-SHA checkout and OIDC for the callback.

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

The hosted default is a workflow stored in the repository being analyzed. The
App installation token dispatches that workflow on the repository's persisted
default branch. The workflow checks out the exact assigned SHA, runs KiCad and
BoardReadyOps on a GitHub-hosted runner, retains logs and artifacts in the
repository, and sends normalized results through a run/attempt-bound OIDC
callback.

This removes the cross-installation problem of a central runner repository and
removes the operational dependency on a BoardReadyOps-operated KiCad VPS. It is
not zero-file onboarding: the repository owner must review and add
`.github/workflows/readiness-runner.yml` before dispatch can succeed. That trade
is preferred over granting the App Contents write.

ADR-0009's signed lease and customer-checkout protocol remains available for an
explicit enterprise self-hosted mode. It is not required by the hosted default.
The public App must not request broader repository, organization, or account
permissions to avoid the target-repository workflow boundary.

## Public-launch completion criteria

The GitHub App is ready for public Marketplace distribution only when:

- the external production/public App settings match the least-privilege profile;
- broad development permissions and unrelated webhook subscriptions are removed;
- target repositories install the reviewed dispatch workflow on their default branches;
- unrelated public and private installations pass dispatch, exact-SHA checkout,
  OIDC callback, result, and tenant-isolation tests;
- installation, repository lifecycle, pull request, Check Run, runner callback,
  and optional comment flows pass end to end with the reduced permissions; and
- issue #88 records the final settings review and validation evidence.
