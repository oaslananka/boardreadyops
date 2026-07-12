# GitHub App permissions and webhook subscriptions

This document is the authoritative least-privilege profile for the shipped
BoardReadyOps GitHub App control plane. It replaces the broader exploratory
permission set described in early architecture notes.

## Shipped control-plane behavior

The current service:

1. verifies signed GitHub App webhooks;
2. records installation and repository lifecycle changes;
3. reacts to pull request `opened`, `reopened`, `synchronize`, and
   `ready_for_review` actions;
4. creates and updates a native GitHub Check Run;
5. optionally dispatches a GitHub Actions workflow;
6. accepts the runner result and completes the Check Run; and
7. attempts to upsert one top-level pull request summary comment as a
   non-blocking enhancement.

The control plane does not currently read repository contents through the
GitHub REST API, create commit statuses, administer repositories, manage
secrets or variables, access organization membership, or use account-level
APIs.

## Minimum repository permissions

### Current single-owner GitHub Actions runner profile

Use this profile for the existing self-hosted production deployment, where the
App installation can access both the analyzed repository and the repository
that contains the dispatch workflow.

| Permission | Level | Required for |
| --- | --- | --- |
| Metadata | Read | GitHub-required repository metadata and installation context |
| Pull requests | Read | Receiving the `pull_request` webhook payload |
| Checks | Read and write | Creating, starting, and completing the BoardReadyOps Check Run |
| Actions | Read and write | Calling the workflow dispatch endpoint in `github-actions` runner mode |

Do not grant any organization or account permissions for this profile.

### Self-hosted or managed execution profile

When execution does not use GitHub workflow dispatch, omit `Actions` access.
The minimum profile is then:

| Permission | Level |
| --- | --- |
| Metadata | Read |
| Pull requests | Read |
| Checks | Read and write |

## Optional pull request summary comments

BoardReadyOps uses the issue-comments REST endpoints because top-level pull
request comments are issue comments in GitHub's data model. GitHub accepts
either of these write permission sets for those endpoints:

- Pull requests: read and write; or
- Issues: read and write.

Grant only one of them. Prefer **Pull requests: read and write** because the
feature writes only to pull request conversations and the App already needs
Pull requests read access for its webhook.

Comment publication is not a release gate. A missing permission or a GitHub
comment API error is retained in the run publication audit state, while a
successfully published Check Run remains authoritative and the runner callback
returns success.

For the public least-privilege profile, leave comment write access disabled
unless the product explicitly ships and supports pull request comments.

## Webhook subscriptions

Subscribe only to:

- `pull_request`

Handle only these actions:

- `opened`
- `reopened`
- `synchronize`
- `ready_for_review`

GitHub Apps receive `installation` and `installation_repositories` events by
default; they are not manually selected subscriptions. `ping` is accepted for
webhook verification.

Do not subscribe to `check_suite`, `check_run`, `status`, `push`,
`issue_comment`, security-alert, deployment, organization, or account events
until corresponding shipped behavior is implemented and tested.

## Permissions that must remain disabled

Unless a future feature has a reviewed permission rationale, keep these set to
No access:

- Administration
- Contents
- Commit statuses
- Deployments
- Environments
- Issues, when optional PR comments are disabled
- Members
- Pages
- Packages
- Repository hooks
- Repository secrets and variables
- Security events and alert APIs
- Workflows, except the `Actions` permission required for the current dispatch mode
- all organization permissions
- all account permissions

The GitHub Actions runner workflow has its own job-scoped `contents: read`
permission. That workflow token is separate from the GitHub App installation
token and does not justify granting repository Contents access to the App.

## Execution-plane boundary

The current `github-actions` mode obtains a token for the installation that
received the pull request webhook, then dispatches a workflow in the configured
runner repository. An installation token cannot cross installation ownership
or repository access boundaries.

Therefore, the existing mode is valid for the current single-owner deployment,
but it is not by itself a zero-configuration multi-tenant Marketplace
execution plane. Before a public Marketplace launch, choose and validate one of
these designs:

- a managed runner that does not require customer installation tokens to access
  a BoardReadyOps-owned dispatch repository;
- a customer-owned runner repository and workflow installed in the same
  installation scope; or
- a separately authenticated dispatch service with an explicit trust model.

Do not broaden the public GitHub App's permissions to work around this boundary.

## Production change procedure

1. Keep a separate development/test App when broad exploratory permissions are
   still required.
2. Configure the public/production App with the minimum profile above.
3. Select only the `pull_request` event.
4. Install the App on selected repositories first, not all repositories.
5. Rotate the webhook secret and private key if development credentials were
   exposed to a broader environment.
6. Re-authorize installations after changing requested permissions.
7. Execute the validation matrix below.
8. Record the App settings review date and reviewer in issue #88.

## Required validation matrix

The permission reduction is complete only after all of these pass against the
reduced production/public App:

- webhook `ping` signature verification;
- installation create and delete lifecycle persistence;
- repository add and remove lifecycle persistence;
- pull request `opened`, `reopened`, `synchronize`, and `ready_for_review`;
- Check Run creation, transition to in-progress, and completion;
- exact runner-result replay behavior;
- GitHub Actions dispatch when that runner mode is enabled;
- pull request comment creation and update only when comment write permission is
  intentionally enabled; and
- confirmation that unsupported or unsubscribed events are not delivered.

Issue #88 must remain open until the external GitHub App settings are changed
and this matrix is re-run end to end.