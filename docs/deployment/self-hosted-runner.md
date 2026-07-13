# Self-hosted runner mode

Issue: #41

A BoardReadyOps self-hosted runner executes hardware-readiness jobs on infrastructure controlled by the customer. The hosted control plane owns tenant authorization, queueing, leases, Check Runs, findings, and artifact metadata. The customer runner owns source checkout, KiCad execution, temporary workspaces, and the credentials required to read private repositories.

## Security boundary

The self-hosted path is intentionally asymmetric:

```text
GitHub webhook
  -> BoardReadyOps control plane
  -> signed lease assignment containing owner/name/commit SHA
  -> customer runner checks out the exact SHA with customer credentials
  -> customer runner uploads reports and a terminal result
  -> control plane updates the GitHub Check Run
```

The control plane does not send a GitHub App installation token, repository archive, source bundle, or file contents to a self-hosted runner. A self-hosted runner accepts only assignments whose `sourceMode` is `customer_checkout`; it rejects `broker` assignments before creating a workspace and relinquishes the lease. Source code remains on the customer runner and its configured Git remote or mirror.

The runner sends only:

- signed claim, heartbeat, relinquish, artifact-capability, and terminal-result requests;
- normalized findings and metrics;
- explicitly generated JSON, SARIF, and Markdown reports;
- artifact bytes covered by server-issued, single-use upload capabilities.

It does not upload the checked-out workspace.

## Prerequisites

The runner host needs:

- Node.js 24;
- the exact supported `boardreadyops` CLI release;
- `git`;
- `kicad-cli` when production checks require KiCad;
- outbound HTTPS access to the BoardReadyOps control plane;
- customer-controlled Git credentials or access to a local bare mirror;
- a dedicated, non-login operating-system account and private state directories.

Do not run the worker as `root`. Run untrusted repositories in a dedicated VM or container boundary; the runner process itself is not a general-purpose sandbox.

## Issue a one-time enrollment token

This step runs on a trusted Linux control-plane administration host with database access and the PostgreSQL client installed at `/usr/bin/psql`. The PostgreSQL URL and generated token are read from and written to files, never command-line arguments or stdout.

```bash
install -d -m 0700 /var/lib/boardreadyops-admin/runner-enrollments
install -m 0600 /run/secrets/boardreadyops-database-url \
  /var/lib/boardreadyops-admin/database-url

boardreadyops runner issue-enrollment \
  --database-url-file /var/lib/boardreadyops-admin/database-url \
  --installation-id 11111111-1111-4111-8111-111111111111 \
  --name factory-runner-01 \
  --scope repository \
  --repository octo-org/private-board \
  --ttl-seconds 900 \
  --token-output /var/lib/boardreadyops-admin/runner-enrollments/factory-runner-01.token
```

Scopes:

| Scope | Meaning |
| --- | --- |
| `installation` | The registration may claim eligible work throughout one GitHub App installation. |
| `organization` | The registration is organization-scoped under the installation policy. |
| `repository` | The registration may claim only the repeated `--repository owner/name` allow-list. |

Enrollment tokens expire after 15 minutes by default and may be configured up to one hour. The output file is created exclusively with mode `0600`; an existing file is never overwritten. Transfer it through an approved secret-delivery channel and remove the administrative copy after activation.

## Activate the customer runner

Create a private token file on the customer runner host, then activate once:

```bash
install -d -m 0700 /var/lib/boardreadyops-runner/bootstrap
install -m 0600 /secure-transfer/factory-runner-01.token \
  /var/lib/boardreadyops-runner/bootstrap/enrollment.token

sudo -u boardreadyops-runner boardreadyops runner activate \
  --url https://boardreadyops.example.com \
  --enrollment-token-file /var/lib/boardreadyops-runner/bootstrap/enrollment.token \
  --identity-dir /var/lib/boardreadyops-runner/identity \
  --capability kicad:10 \
  --capability linux-x64 \
  --label factory
```

Activation generates an Ed25519 keypair locally. The private key never leaves the runner. The identity directory contains:

```text
runner.json
runner-private-key.pem
runner-public-key.pem
```

On POSIX systems the directory is mode `0700` and each file is mode `0600`. The identity JSON stores the control-plane origin, registration ID, capabilities, labels, activation timestamp, and relative key filenames. It does not store the enrollment token or private-key contents.

Delete the one-time token immediately after successful activation:

```bash
shred -u /var/lib/boardreadyops-runner/bootstrap/enrollment.token
```

Where `shred` is not appropriate for the underlying storage, delete the file through the platform's secret-management workflow.

## Private repository credentials

The runner performs a normal HTTPS Git fetch of the exact commit SHA assigned by the server. Configure credentials under the dedicated runner account using a customer-owned mechanism, for example:

- an organization-managed Git credential helper;
- a fine-grained GitHub token limited to read-only repository contents;
- a customer-owned GitHub App credential broker;
- a local bare mirror synchronized by a separate customer process.

The worker sets `GIT_TERMINAL_PROMPT=0`, removes inherited `GIT_DIR`, `GIT_WORK_TREE`, and related variables, disables hooks and commit signing, performs a detached checkout, verifies the resulting SHA, and removes the remote from the temporary worktree.

A local mirror avoids repository credentials in the worker process:

```bash
boardreadyops runner once \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces \
  --repository-mirror-root /srv/git-mirrors
```

The expected mirror layout is:

```text
/srv/git-mirrors/<owner>/<repository>.git
```

Mirror synchronization is outside the worker loop and remains customer-controlled.

## Process one job

Use `once` for commissioning, scheduled execution, and troubleshooting:

```bash
sudo -u boardreadyops-runner boardreadyops runner once \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces \
  --heartbeat-seconds 30 \
  --format json
```

The command exits `0` both when one job completes and when the queue is empty. A claimed job is processed through these lease stages:

1. `preparing_source`;
2. `running`;
3. `uploading_artifacts`;
4. `reporting`.

The worker runs the existing BoardReadyOps pipeline in enforce mode, writes JSON, SARIF, and Markdown reports, requests upload capabilities bound to the active lease, uploads the exact declared byte counts, and publishes a terminal result. Temporary workspaces are removed by default. `--keep-workspace` is intended only for controlled debugging and increases source-retention risk.

`kicad-cli` is required by default. Use `--no-require-kicad` only for a deliberate reduced-capability test runner.

## Run continuously

```bash
sudo -u boardreadyops-runner boardreadyops runner serve \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces \
  --heartbeat-seconds 30 \
  --poll-seconds 15 \
  --format json
```

`serve` handles `SIGINT` and `SIGTERM`, stops polling, and relinquishes a claimed lease when shutdown interrupts execution. Transient claim errors are logged and retried after the configured poll interval.

## systemd example

```ini
[Unit]
Description=BoardReadyOps customer self-hosted runner
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=boardreadyops-runner
Group=boardreadyops-runner
Environment=HOME=/var/lib/boardreadyops-runner
ExecStart=/usr/local/bin/boardreadyops runner serve --identity /var/lib/boardreadyops-runner/identity/runner.json --workspace-root /var/lib/boardreadyops-runner/workspaces --heartbeat-seconds 30 --poll-seconds 15 --format json
Restart=on-failure
RestartSec=10
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectHome=true
ProtectSystem=strict
ReadWritePaths=/var/lib/boardreadyops-runner

[Install]
WantedBy=multi-user.target
```

When private-repository credentials live outside `/var/lib/boardreadyops-runner`, grant only the minimum additional read access required by the selected credential helper or mirror.

## Network policy

No inbound port is required on the runner. Permit outbound connections only to:

- the BoardReadyOps control-plane HTTPS origin;
- the customer Git host, or the local mirror endpoint;
- package or operating-system update endpoints used by the customer's maintenance process.

The control plane uses Ed25519 signatures, a bounded timestamp window, and single-use nonces for runner mutations. Artifact uploads use short-lived, single-use HTTPS capabilities tied to the run, execution attempt, lease, artifact ID, declared byte count, and optional SHA-256 digest.

## Storage and retention

Recommended layout:

```text
/var/lib/boardreadyops-runner/identity       # persistent, 0700
/var/lib/boardreadyops-runner/workspaces     # ephemeral source checkout, 0700
/var/lib/boardreadyops-runner/bootstrap      # one-time token staging, empty after activation
/srv/git-mirrors                            # optional customer-managed bare mirrors
```

Back up the identity directory as a secret. Do not copy it into images, source repositories, CI artifacts, or general-purpose backup sets without encryption and access controls. Workspaces should not be backed up and should be placed on encrypted storage where required by policy.

Uploaded report artifacts are stored by the control plane's configured artifact driver. They contain BoardReadyOps reports, not an automatic source archive. Findings may include repository-relative paths and diagnostic messages; treat them according to the tenant's engineering-data classification.

## Update and rollback

Pin the runner to an exact BoardReadyOps release. Before updating:

1. stop the service;
2. confirm no active lease remains for the registration;
3. retain the previous binary or package artifact;
4. install and verify the new exact version;
5. run `runner once` as a commissioning check;
6. restart the service and observe the first heartbeat and completed Check Run.

Example:

```bash
systemctl stop boardreadyops-runner
boardreadyops --version
# Install the approved exact release through the customer's package channel.
boardreadyops --version
sudo -u boardreadyops-runner boardreadyops runner once \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces
systemctl start boardreadyops-runner
```

Rollback by stopping the service, restoring the previous exact binary, and restarting. The persisted identity format is versioned; an unsupported version fails closed rather than silently regenerating credentials.

## Private-repository acceptance evidence

A production acceptance run should record all of the following:

1. the GitHub repository is private;
2. the release run is routed to `self_hosted` and the claimed job reports `sourceMode=customer_checkout`;
3. the customer runner checks out the exact assigned SHA with customer credentials or a customer mirror;
4. the control-plane host contains no checkout workspace for that repository and receives no repository token;
5. signed heartbeat stages advance through source preparation, execution, artifact upload, and reporting;
6. the GitHub Check Run reaches a terminal conclusion with findings and report links;
7. the runner lease, registration, artifact capabilities, terminal result, and audit records share the same run and execution-attempt IDs;
8. the temporary customer workspace is removed after completion.

Retain IDs, timestamps, Check Run URL, artifact digests, and audit-event references. Do not retain the enrollment token, lease token, upload capability, Git credential, source archive, or runner private key in the evidence bundle.

## Failure behavior

The worker fails closed when:

- the control-plane URL is non-HTTPS, except explicit loopback testing;
- identity or secret files have broad POSIX permissions;
- a job requests managed/brokered source delivery;
- checkout resolves to a SHA other than the assignment;
- the lease becomes closed or stale;
- artifact size or capability metadata does not match;
- a signed request is rejected or replayed;
- the terminal result cannot be bound to the active execution attempt.

Execution errors cause best-effort lease relinquishment and workspace cleanup. The control plane remains authoritative for stale leases, duplicate terminal results, and conflicting attempts.
