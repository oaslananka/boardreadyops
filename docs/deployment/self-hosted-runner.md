# Self-hosted runner mode

Issue: #41

A BoardReadyOps self-hosted runner executes hardware-readiness jobs on infrastructure controlled by the customer. The hosted control plane owns tenant authorization, queueing, leases, Check Runs, findings, and artifact metadata. The customer runner owns source checkout, KiCad execution, temporary workspaces, and the credentials required to read private repositories.

This is an optional enterprise/customer-controlled execution mode. The hosted default is target-repository GitHub Actions as defined in [GitHub Actions execution mode](github-actions-execution.md). `ops-vps-03` or another BoardReadyOps-operated worker is not required for the default hosted service.

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

For the self-hosted cloud deployment, derive the administrative URL from the existing root-only runtime environment without printing credentials:

```bash
sudo BOARDREADYOPS_ADMIN_DATABASE_HOST=postgres.internal \
  pnpm run cloud:provision:admin-db-url
```

The command follows `BOARDREADYOPS_CLOUD_RUNTIME_ENV_FILE` (including a symlink to a private regular file), requires the resolved file to have no group/other permissions, percent-encodes the PostgreSQL credentials, and atomically writes `/var/lib/boardreadyops-admin/database-url` with mode `0600`. Set `BOARDREADYOPS_ADMIN_DATABASE_HOST` to a database endpoint reachable from the administration host; the default is `bro-postgres`. The secret value is never written to stdout or command arguments. An external secret manager may instead provision the same root-only URL file directly.

```bash
install -d -m 0700 /var/lib/boardreadyops-admin/runner-enrollments

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

The worker runs the existing BoardReadyOps pipeline in enforce mode, writes JSON, SARIF, and Markdown reports, requests upload capabilities bound to the active lease, uploads the exact declared byte counts, and publishes a terminal result. Safe-mode execution disables repository-provided plugins and notifier dispatch before analysis, so repository code cannot consume ambient notifier credentials or request plugin network/process permissions through the runner process. Temporary workspaces are removed by default. `--keep-workspace` is intended only for controlled debugging and increases source-retention risk. Safe-mode jobs always remove their workspace; `--keep-workspace` is ignored for those jobs and the worker emits `runner.workspace.retention_overridden` without source content or credential values.

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

`serve` handles `SIGINT` and `SIGTERM`, stops polling, and relinquishes a claimed lease when shutdown interrupts execution. Transient claim errors are logged and retried after the configured poll interval. A valid signed claim poll refreshes the registration presence timestamp and, when supplied, the last reported strict agent version even when the queue is empty. A replayed request, a capability mismatch, an invalid signature, or a minimum-version rejection does not refresh presence.

## Operator fleet visibility

An authenticated control-plane operator can read one installation's aggregate customer-runner state:

```http
GET /api/v1/operator/installations/{installationId}/runner-fleet
Authorization: Bearer <operator-token>
```

The response uses a fixed five-minute reporting window and contains only aggregate values:

```json
{
  "ok": true,
  "fleet": {
    "observedAt": "2026-08-02T09:30:00.000Z",
    "observationWindowSeconds": 300,
    "status": "degraded",
    "registrations": {
      "active": 3,
      "online": 2,
      "stale": 1,
      "versionUnreported": 0,
      "lastSeenAt": "2026-08-02T09:29:55.000Z"
    },
    "queue": { "pendingJobs": 4, "oldestAgeSeconds": 600 },
    "leases": { "active": 2, "earliestExpirySeconds": 90 },
    "versions": [{ "version": "1.27.1", "registrations": 2 }]
  }
}
```

Status meanings:

- `not_configured`: no active self-hosted registrations exist for the installation;
- `healthy`: every active registration reported within the five-minute observation window;
- `degraded`: at least one, but not every, active registration reported within the window;
- `offline`: active registrations exist but none reported within the window.

The five-minute window is an operator reporting convention, not the repository routing policy. Claim eligibility continues to use each effective runner policy's `self_hosted_offline_after_seconds` value. Queue age includes only tenant runs that are currently eligible for a self-hosted policy and do not carry draft- or fork-PR safe-mode reasons. Active lease counts include only unexpired self-hosted leases. Version groups are sorted by numeric `major.minor.patch` order.

The endpoint never returns repository owner/name, commit SHA, source or workspace paths, allowed-repository patterns, public keys, fingerprints, enrollment data, lease tokens, or individual runner identifiers. Responses are `no-store`; operator authentication and the installation identifier are validated before PostgreSQL access.

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

## Deployment profiles

### Dedicated VM or bare-metal host

The systemd example is the recommended production baseline. Use one dedicated operating-system account per runner identity, encrypted local storage, a private identity directory, and a workspace filesystem that is excluded from backups. Run one worker process per identity.

### Container

A container deployment must preserve the same host boundary rather than weakening it:

- run as a fixed non-root UID and GID;
- use a read-only root filesystem;
- mount the identity directory and Git credentials from a customer secret store with no group or other access;
- mount a separate writable workspace volume or memory-backed filesystem that is destroyed with the container;
- drop Linux capabilities, enable `no-new-privileges`, and do not mount the Docker socket, host PID namespace, host network namespace, or broad host paths;
- install the exact approved BoardReadyOps, Node.js, Git, and KiCad versions in the image; and
- emit only structured runner events to the container log driver.

Do not bake `runner-private-key.pem`, enrollment tokens, Git credentials, or repository mirrors into an image layer. Use a fresh enrollment for each new identity and keep the same identity mounted when restarting the same logical runner.

### Kubernetes

Use a single-replica `StatefulSet` or an equivalent controller that guarantees one active pod per runner identity. Do not share one identity across concurrent replicas. No Kubernetes `Service` or `Ingress` is required.

- Store the identity in a dedicated Secret or CSI secret volume; enable encryption at rest and restrict RBAC to the runner service account.
- Use an `emptyDir`, generic ephemeral volume, or customer-managed encrypted ephemeral volume for workspaces. Never place workspaces in a retained shared PVC.
- Set `runAsNonRoot`, a fixed UID/GID, `readOnlyRootFilesystem`, `allowPrivilegeEscalation: false`, and drop all capabilities.
- Apply an egress-only `NetworkPolicy` for the control plane, Git or mirror endpoint, artifact endpoint, DNS, and approved update infrastructure.
- Set a termination grace period long enough for the worker to stop polling, relinquish an active lease, and remove its workspace. The control plane remains authoritative if the pod is killed before cleanup completes.
- Use a `PodDisruptionBudget` only when it does not encourage two pods to mount the same identity simultaneously.

A horizontal replica increase requires separately enrolled identities and control-plane routing capacity; cloning a Secret to create more replicas is not a valid scaling method.

### Restricted and disconnected environments

A fully disconnected runner cannot participate because claim, heartbeat, lease, and result requests require the control plane. A restricted environment may use an outbound gateway and a customer-local Git mirror. Package and image promotion may be performed through an offline customer channel, but the installed artifacts must still be verified against the approved release digest or attestation before the worker is started.

## Network and restricted-environment policy

The runner opens outbound connections only; do not publish a Service, load balancer, ingress, SSH port, or callback listener for BoardReadyOps. The customer firewall and DNS policy should allow only the destinations required by the selected source and artifact modes:

| Purpose | Required destination | Notes |
| --- | --- | --- |
| Control-plane protocol | The configured BoardReadyOps HTTPS origin on TCP 443 | Required for activation, claim, heartbeat, lease, capability, and result requests. |
| Source checkout | The customer Git host on TCP 443, or a customer-local mirror | Not required when every assignment is served from a local mirror. |
| Managed artifact upload | The HTTPS host embedded in a server-issued upload capability | The capability is short-lived and attempt-bound; do not broad-allow arbitrary object-storage endpoints. |
| Updates | Customer-approved package, image, operating-system, and time-synchronization endpoints | Keep update traffic separate from the worker process where policy requires it. |

The control plane uses Ed25519 signatures, a bounded timestamp window, and single-use nonces for runner mutations. Artifact uploads use short-lived, single-use HTTPS capabilities tied to the run, execution attempt, lease, artifact ID, declared byte count, and optional SHA-256 digest.

DNS must resolve the control-plane and selected Git or artifact hosts. System time must remain synchronized because runner signatures use a bounded timestamp window. TLS interception is supported only when the customer explicitly trusts the intercepting CA at the operating-system or Node.js trust boundary and has verified that the proxy does not log authorization headers, signed request bodies, upload capabilities, or Git credentials. Disable TLS interception for the control-plane path when that guarantee cannot be made.

Application-level `HTTP_PROXY`, `HTTPS_PROXY`, and `NO_PROXY` handling is not currently a supported runner contract. Restricted environments should use a transparent egress gateway, a customer-local Git mirror, or another network layer that does not require the runner process to understand proxy credentials. Treat proxy credentials as secrets and never place them in command-line arguments, identity JSON, unit files committed to source control, or diagnostic bundles.

Commission a restricted-network installation by proving all of the following before enabling production routing:

1. activation reaches the exact HTTPS origin and rejects a hostname or CA mismatch;
2. `runner once` can claim an empty queue without any inbound listener;
3. an exact-SHA checkout succeeds through the approved Git path;
4. a capability-bound upload succeeds only to the expected artifact host;
5. DNS, TLS, proxy, and firewall logs contain no enrollment token, signing key, Git credential, lease token, capability, source path, or finding payload; and
6. removing any required egress rule fails closed and leaves the lease recoverable by expiry or relinquishment.

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

## Supported versions, update, and rollback

The production support contract is intentionally strict:

- pin the runner to an exact BoardReadyOps release and record its digest or package provenance;
- use Node.js 24 and a KiCad major supported by that BoardReadyOps release;
- treat the exact version validated with the deployed control-plane release as the supported production version; and
- configure `BOARDREADYOPS_SELF_HOSTED_RUNNER_MIN_VERSION` on the control plane when new claim requests from older runners must be rejected.

The runner sends its strict `major.minor.patch` version with a dedicated Ed25519 extension signature while retaining the legacy primary signature for control-plane rollback compatibility. When the minimum is configured, a missing or lower version receives HTTP 426 before any lease or execution attempt is created. Managed-runner claims are unaffected. Enforcement is intentionally claim-time only: existing leases may drain through heartbeat, artifact, result, and relinquish requests during an upgrade. An invalid configured minimum makes `/api/health/ready` fail closed. This setting is deployment-wide; there is not yet a public per-registration minimum-version administration command.

Roll out an upgrade one identity at a time. Before updating:

1. stop routing new work to the identity;
2. wait for or relinquish the active lease;
3. stop the worker service;
4. retain the previous verified binary or image;
5. install the new exact version and verify its digest or provenance;
6. run `boardreadyops doctor`;
7. run `runner once` against a commissioning repository; and
8. restore normal routing only after the first heartbeat and terminal Check Run succeed.

Example:

```bash
systemctl stop boardreadyops-runner
boardreadyops --version
# Install the approved exact release through the customer's package channel.
boardreadyops --version
boardreadyops doctor
sudo -u boardreadyops-runner boardreadyops runner once \
  --identity /var/lib/boardreadyops-runner/identity/runner.json \
  --workspace-root /var/lib/boardreadyops-runner/workspaces
systemctl start boardreadyops-runner
```

Record the old and new versions, artifact digests, identity ID, timestamps, and commissioning run ID without recording credentials or source.

Rollback uses the same drain-and-stop procedure, restores the previous verified binary or image, and reuses the existing identity only when its schema is still supported. If identity loading fails closed, do not edit the JSON or private key in place. Use the deployment's authorized control-plane administration procedure to disable the registration, create a new one-time enrollment, activate a new identity, and remove the superseded private key through the customer secret-destruction process. There is not yet a public self-service key-rotation or per-registration minimum-version administration command. Copying or regenerating a private key outside enrollment is not a supported rotation procedure.

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
