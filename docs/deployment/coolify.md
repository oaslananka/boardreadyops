# Coolify: single-production self-hosted deployment

This runbook retains the Git-sourced all-in-one Docker Compose provisioning template at deploy/docker-compose.coolify.yml. It is **not** the commissioned rolling-web deployment topology. Never run the legacy template against an active production stack or use it to recreate running stateful services.

## Current commissioned production topology (verified 10 November 2026)

The existing single Cloudflare Tunnel connector runs **independently** of the web application and reaches **private Traefik ingress**. Traefik forwards to a Coolify **Dockerfile rolling web application**. The original worker, PostgreSQL 17 and Redis 8 remain separately managed stateful services. Web has no published host port; the private-network source allowlist protects both HTTP and HTTPS routes. Actual origin selection, authentication, credentials and recovery routing are operator-controlled, not copied into this public template.

For a same-source rolling web release, preserve the pinned web commit, single connector, stateful services, existing rollback image and private routing. Start external HTTPS/transport and independently authenticated customer-path witnesses **before** the release. Sample through new-web readiness, old/new overlap, drain, retirement and post-release stability. Verify terminal deployment status and immutable image/source identity. Previous request-level witnesses or successful healthcheck spot checks do not establish zero failure for another release.

The 10 November controlled rolling-web continuity incident was resolved in [issue #1433](https://github.com/oaslananka/boardreadyops/issues/1433) with sampled authenticated-session evidence. Every **new** production cutover, including worker/database changes, still requires its own runtime and customer-path acceptance; the earlier evidence does not transfer to another deployment. A first useful signed PCB result is a separate product acceptance gate. Do not commit release-policy files, tunnel credentials, origin addresses or private operator procedures to this repository.

## Worker-only handoff resource (source-prepared, not commissioned)

`deploy/docker-compose.worker.yml` defines a separate Git-sourced **worker-only**
Coolify Compose application. It creates no web, tunnel, PostgreSQL, Redis or
migration service and publishes no host port. It requires an existing private
Docker network, external artifact volume, the existing read-only release-policy
file and the same protected configuration as the current worker. Its readiness
check uses port 3001 and requires database and GitHub Actions configuration
to be valid, overriding the Docker image's web-only health check on port 3000.

This source template is **not deployed** and does not authorize cutover.
Keep automatic deployment disabled; verify backups, rollback, the migrated
schema, queues/leases, policy/artifact access and authenticated customer paths.
**Stop and verify the old worker has fully exited before starting the new one.**
Coolify's rolling application update could run both workers concurrently.
Never redeploy the old all-in-one Compose stack. If the new worker fails,
stop it and verify schema/queue rollback compatibility before considering
restart of the retained legacy worker. Actual GitHub Actions execution and
customer acceptance remain separate release gates.

### Post-migration rollback: preserve writes, do not restart an incompatible worker

A successful backup restore is a **recovery point**, not permission to restore
that snapshot over a live database that has accepted newer customer writes.
Before a worker/schema cutover, stop the previous worker and independently
verify that no other queue, outbox, reconciliation or artifact-unlink actor
can consume the same state. Record the last accepted write boundary and
reconcile webhook/outbox leases and any work committed **after** the backup.
A momentary zero-leased-job query is not a write fence while the web or GitHub
webhook ingress can still accept new work.

Migration `0128_reused_github_repository_name_identity.sql` deliberately permits
a new GitHub repository ID to reuse an old **disabled** repository's
installation/owner/name while preserving historical links. If such a
replacement has been recorded, the older global
`repositories_installation_id_owner_name_key` uniqueness constraint cannot
be reintroduced without rejecting legitimate persisted rows. A rollback
must not restart an old pre-0128 worker on an unverified new schema, nor
restore an earlier dump and silently discard newer runs or repository
identities.

**Fail-closed recovery choice:** if the post-backup write set is not
independently preserved and replayable, or old-worker schema compatibility
cannot be proved, keep the old worker stopped. Repair forward using the
current schema and a verified single writer, or prepare a separately
reviewed, isolated restore/catch-up with a proven write freeze and no
unaccounted customer records. Recheck affected GitHub side effects before
any retry; never blanket-replay old dead-letter jobs. The offline 0113-to-0128
migration drill proves data preservation *in that fixture only*, not a
live stop-first cutover, rollback or customer signed PCB result.

## Legacy all-in-one Compose template topology

The **template** contains web, control-plane worker, one-shot database migration, PostgreSQL, Redis and Cloudflare Tunnel. It does not publish host ports 80/443 or start another Caddy reverse proxy. In this legacy template, the tunnel routes to web:3000 on its private Compose network. This is not the live independent-connector / rolling-web route.

The PostgreSQL, Redis and local artifact volumes use external: true. Coolify must reuse the existing verified volumes, and must never access them concurrently with the old deployment. Web and worker share exactly one artifact volume and both mount the read-only release-repository policy.

This template is not itself deployment authorization. Host paths, tunnel identity, secrets, production image and recovery are operator-controlled.

## Configure a legacy Compose installation (not the current rolling web)

1. In Coolify use one project with one production environment. Choose a GitHub App-backed Application with Docker Compose from main, file deploy/docker-compose.coolify.yml. Leave automatic deploy and pull-request previews disabled until cutover is accepted. Do not add another environment.
2. Verify that Coolify provides SOURCE_COMMIT for the selected immutable Git commit and enables source-commit availability during Docker builds. This pins the web, worker and migration image to one revision without manually changing tags on every GitHub deployment. Configure the normal runtime values through the approved secrets provider, using Doppler where supported by the installed Coolify version. The Compose application must receive a generated .env file containing runtime values used by web, worker and migrate. Never commit the file or log credentials.
3. Configure DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB together in the protected Coolify .env. The image and database read secrets from that file rather than constructing connection strings in Compose. Set BOARDREADYOPS_POSTGRES_VOLUME, BOARDREADYOPS_REDIS_VOLUME and BOARDREADYOPS_ARTIFACT_VOLUME to exactly the existing named volumes. Verify the effective DATABASE_URL resolves the intended postgres service.
4. Supply absolute host-file paths for BOARDREADYOPS_RELEASE_POLICY_HOST_FILE, BOARDREADYOPS_TUNNEL_CONFIG_HOST_FILE and BOARDREADYOPS_TUNNEL_CREDENTIALS_HOST_FILE. Verify paths, file permissions and read-only mounts. Ensure that the tunnel config still routes intended hostnames to http://web:3000.
5. Coolify's volume security validator accepts a plain variable in a bind-mount source (for example `source: ${BOARDREADYOPS_TUNNEL_CONFIG_HOST_FILE}`), but rejects Docker Compose required-value syntax there (`${NAME:?message}`). The read-only bind-source variables and the three external volume name references therefore use plain references. Required-value checks for all seven variables are mirrored into service environment entries, preserving fail-closed validation. **Before deployment**, verify all three values are nonempty absolute paths to existing regular files and that the mounts remain read-only; do not substitute empty or auto-created host paths. Missing host paths or external volume names fail Compose validation; do not replace missing values with automatically created volumes or directories.
6. For Coolify builds the project directory is the cloned repository root. The migrate service uses build.context: . with dockerfile: apps/web/Dockerfile. Do not use .., which resolves outside the cloned repository to a nonexistent /artifacts/apps path. Validate the build context using Coolify's actual --project-directory <repository-root> option.
7. Review both the Coolify source and generated Compose, including volumes, healthchecks, network attachment, service start order and absence of published host ports. Mark the successful one-shot migrate service as excluded from continuous application health checks in Coolify; it is expected to stop after finishing.

## Availability limitation and readiness behavior

The Docker image healthcheck uses /api/health/ready (not dependency-free /api/health liveness), so it is healthy only when required configuration and PostgreSQL readiness are verified. On SIGTERM/SIGINT the web process marks readiness as unavailable while keeping Next.js's own graceful shutdown handler. Operators must still configure sufficient stop/drain time when transitioning to a rolling-capable deployment type.

**This does not eliminate downtime in a Git-sourced all-in-one Docker Compose deployment.** Coolify can stop and reconcile the template's tunnel, web and stateful services. An earlier production Compose cutover returned Cloudflare HTTP 530 before the replacement tunnel connected; production has since migrated to an independent connector and rolling web. Retaining this template is not permission to revert that topology. See #1433 for the current continuity acceptance contract.

## Web readiness drain prerequisite (not a Compose zero-downtime fix)

The Dockerfile web runner now uses a small Node parent process. On SIGTERM/SIGINT it creates the rootless, container-local /run/boardreadyops/draining readiness marker with owner-only permissions, while the existing Next.js child continues serving for **12 seconds**. The regular /api/health/ready returns HTTP 503 during that window; liveness remains up. The Docker image healthcheck runs every **3 seconds** (two consecutive failed probes to become unhealthy), allowing the existing Traefik Docker provider to stop routing new work to the terminating container. Only after the drain interval does the parent forward the signal to Next.js for its own graceful shutdown. On an unexpected child exit the parent exits nonzero; a process restart clears a stale drain marker before starting its child. No public shutdown route or extra permanently running service is added.

**Required for a future rolling-eligible Dockerfile deployment:** stop-grace duration of at least **30 seconds** (parent drain plus child shutdown), simultaneous old/new web readiness and Traefik routing, **stable** database/Redis/worker and a separately persistent **single** existing Cloudflare Tunnel. The private origin must stay private and deny direct-public-host and untrusted Docker network requests on **both HTTP and HTTPS** routers; do not publish a direct web port. Do not enable these changes solely based on a synthetic test: verify real Next.js/SSE/long-lived requests, authenticated session continuity, migration compatibility, rollback and a complete public cutover witness. A 3-second healthcheck and 12-second drain delay mitigate a tested routing race; they do not by themselves guarantee all requests survive.

**The legacy template still uses stop-then-start Docker Compose** and must not be confused with the commissioned production topology described above. The current Dockerfile web application uses rolling replacement and a separately persistent connector, while the original stateful services remain running. Neither a drain delay nor a passing HTTP200 spot check proves session preservation or zero failed requests during every release. Keep #1433 open until the real customer-path acceptance is recorded for the applicable cutover.

## Mandatory cutover prerequisites

- Identify the running image SHA and preserve a known good rollback image, database snapshot, and artifact recovery path.
- Verify an encrypted backup with a completed restore check. Confirm artifact/legal holds, queue leases, migrations, and single-writer fencing.
- Require all source CI and release gates. Do not combine a deployment-controller change with an unreviewed schema or authentication change.
- Make sure the previous GitHub Actions cloud-deploy workflow cannot reactivate the old stack during or after cutover.
- Preserve authorization, trusted client-IP ingress, session cookies, GitHub webhook signatures, remote MCP, artifact ownership and release-policy mount checks.
- A missing required secret, unverified volume, unverified OAuth ingress contract or unprotected rollback is a stop condition.

## Legacy one-time Compose cutover (not for the current live stack)

1. Fence inbound writes and workers using the existing operations procedure, then stop the previous Compose services without -v. Keep the previous container image and the volumes. Never run old and new against the same volumes.
2. Configure verified runtime secrets and mount paths in Coolify, then deploy the single production application. Migration must succeed before web and worker start. Check that exactly one web, worker, PostgreSQL, Redis and Cloudflare Tunnel are active for this installation.
3. Verify the public HTTPS endpoints, application and worker health, database schema, OAuth consent/authorization, webhook delivery, GitHub App access, release policy, and artifact permissions.
4. Enable GitHub-triggered Coolify deploy only after verified acceptance and after retiring the legacy deploy route. No separate persistent pre-production environment is needed.

If Coolify deployment fails, stop its containers without deleting volumes. Assess migration backward compatibility before restarting the old image; forward-only schema changes may require a verified data restore. No host-wide Docker prune or volume deletion is part of cutover.

## Offline syntax check

Copy the Compose file into a disposable directory, provide only dummy nonproduction environment values and a local .env, then run:

    docker compose --env-file .env -f docker-compose.coolify.yml config --quiet

This does not deploy or run migrations. A successful parse is not evidence of working production OAuth, ingress or artifact recovery.


## Ongoing production recovery backups

Coolify Storage Backups only lists eligible managed application mounts. The existing
PostgreSQL and artifact data use named external Compose volumes and must not be
replaced or copied as a live PostgreSQL filesystem snapshot. Do not create a storage
backup schedule for the release-policy mount; it does not protect the database.
Coolify's database-aware scheduler also does not manage a PostgreSQL service that is
part of this application Compose. Use the host-side, engine-aware maintenance script
below instead. No staging environment, additional always-on container, or new paid
provider is required.

The deployment operator supplies an existing private directory with 0700 permissions
and a private config file at $HOME/.config/boardreadyops/coolify-backup.env. Populate
these names from the **verified live** Coolify Compose project and Docker mounts:

    BOARDREADYOPS_COMPOSE_PROJECT=<current Coolify Compose project identity>
    BOARDREADYOPS_POSTGRES_VOLUME=<existing production PostgreSQL volume name>
    BOARDREADYOPS_ARTIFACT_VOLUME=<existing production artifact volume name>
    BOARDREADYOPS_BACKUP_DIR=<absolute private backup directory, mode 0700>
    BOARDREADYOPS_BACKUP_KEEP=7
    BOARDREADYOPS_ROLLING_WEB_APP_UUID=<Coolify UUID of the independent rolling web, if used>

The PostgreSQL service remains inside the original Compose project. For the
separate rolling-web production topology, set `BOARDREADYOPS_ROLLING_WEB_APP_UUID`
to the verified active Coolify web application UUID. The backup script
requires exactly one running container with that label and a healthy web;
an absent, invalid or ambiguous match fails closed. Omitting the variable
uses the legacy Compose web service only, and cannot fall back to another
application when the legacy web has stopped. Keep this UUID in the private
host config, not in versioned source.

Install deploy/maintenance/coolify-production-backup.sh at
$HOME/.local/libexec/boardreadyops-coolify-backup.sh (mode 0700), and install
boardreadyops-coolify-backup.service and boardreadyops-coolify-backup.timer in
$HOME/.config/systemd/user/. The timer runs daily at 02:40 in the host's local
timezone, with up to five minutes of jitter; its 15-minute service timeout
prevents overlapping/unbounded work. Enable it only after an operator confirms
systemd user timers work without an interactive shell and runs:

    systemctl --user daemon-reload
    systemctl --user start boardreadyops-coolify-backup.service
    systemctl --user enable --now boardreadyops-coolify-backup.timer
    systemctl --user list-timers --all
    journalctl --user -u boardreadyops-coolify-backup.service -n 30 --no-pager

Run the script with --preflight first to validate the runtime without writing
a backup. Each successful run creates a custom-format pg_dump, a gzip-compressed
artifact archive and a SHA-256 manifest, all with owner-only permissions.
It refuses absent/ambiguous or unhealthy containers, unexpected data volume
names, inaccessible Docker, unsafe backup permissions, or low disk space.
Archive size is capped to 1 GiB per file, each capture is time-bounded,
and only files created by this exact scheduled job are eligible for seven-copy
rotation. Existing pre-deployment and operator backups are never rotated by
this script. PostgreSQL dump catalog and tar readability are verified after
capture; periodically perform a **full restore into a disposable isolated
database** and compare table counts and representative data before trusting
the schedule. A dump listing alone is not a restore test.

Local backups on the same VPS cannot survive host or disk loss. Keep a separately
protected, periodically verified off-server copy when an approved destination
is available. Do not enable unbounded uploads, new paid storage, or secret
transfers merely because a backup schedule is enabled.
