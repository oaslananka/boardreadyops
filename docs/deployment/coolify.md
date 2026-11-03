# Coolify: single-production self-hosted deployment

This is a Git-sourced Docker Compose application for a BoardReadyOps installation that already runs on the same Docker host. It is not a second environment or second live control plane. Source: deploy/docker-compose.coolify.yml.

## Deployment topology

The stack contains web, control-plane worker, one-shot database migration, PostgreSQL, Redis and Cloudflare Tunnel. It does not publish host ports 80/443 or start another Caddy reverse proxy. The tunnel routes to web:3000 on its private Compose network. The application's public HTTPS origins remain assigned to the existing verified Cloudflare Tunnel.

The PostgreSQL, Redis and local artifact volumes use external: true. Coolify must reuse the existing verified volumes, and must never access them concurrently with the old deployment. Web and worker share exactly one artifact volume and both mount the read-only release-repository policy.

This template is not itself deployment authorization. Host paths, tunnel identity, secrets, production image and recovery are operator-controlled.

## Configure one production application

1. In Coolify use one project with one production environment. Choose a GitHub App-backed Application with Docker Compose from main, file deploy/docker-compose.coolify.yml. Leave automatic deploy and pull-request previews disabled until cutover is accepted. Do not add another environment.
2. Verify that Coolify provides SOURCE_COMMIT for the selected immutable Git commit and enables source-commit availability during Docker builds. This pins the web, worker and migration image to one revision without manually changing tags on every GitHub deployment. Configure the normal runtime values through the approved secrets provider, using Doppler where supported by the installed Coolify version. The Compose application must receive a generated .env file containing runtime values used by web, worker and migrate. Never commit the file or log credentials.
3. Configure DATABASE_URL, POSTGRES_USER, POSTGRES_PASSWORD and POSTGRES_DB together in the protected Coolify .env. The image and database read secrets from that file rather than constructing connection strings in Compose. Set BOARDREADYOPS_POSTGRES_VOLUME, BOARDREADYOPS_REDIS_VOLUME and BOARDREADYOPS_ARTIFACT_VOLUME to exactly the existing named volumes. Verify the effective DATABASE_URL resolves the intended postgres service.
4. Supply absolute host-file paths for BOARDREADYOPS_RELEASE_POLICY_HOST_FILE, BOARDREADYOPS_TUNNEL_CONFIG_HOST_FILE and BOARDREADYOPS_TUNNEL_CREDENTIALS_HOST_FILE. Verify paths, file permissions and read-only mounts. Ensure that the tunnel config still routes intended hostnames to http://web:3000.
5. Coolify's volume security validator accepts a plain variable in a bind-mount source (for example `source: ${BOARDREADYOPS_TUNNEL_CONFIG_HOST_FILE}`), but rejects Docker Compose required-value syntax there (`${NAME:?message}`). The read-only bind-source variables and the three external volume name references therefore use plain references. Required-value checks for all seven variables are mirrored into service environment entries, preserving fail-closed validation. **Before deployment**, verify all three values are nonempty absolute paths to existing regular files and that the mounts remain read-only; do not substitute empty or auto-created host paths. Missing host paths or external volume names fail Compose validation; do not replace missing values with automatically created volumes or directories.
6. For Coolify builds the project directory is the cloned repository root. The migrate service uses build.context: . with dockerfile: apps/web/Dockerfile. Do not use .., which resolves outside the cloned repository to a nonexistent /artifacts/apps path. Validate the build context using Coolify's actual --project-directory <repository-root> option.
7. Review both the Coolify source and generated Compose, including volumes, healthchecks, network attachment, service start order and absence of published host ports. Mark the successful one-shot migrate service as excluded from continuous application health checks in Coolify; it is expected to stop after finishing.

## Mandatory cutover prerequisites

- Identify the running image SHA and preserve a known good rollback image, database snapshot, and artifact recovery path.
- Verify an encrypted backup with a completed restore check. Confirm artifact/legal holds, queue leases, migrations, and single-writer fencing.
- Require all source CI and release gates. Do not combine a deployment-controller change with an unreviewed schema or authentication change.
- Make sure the previous GitHub Actions cloud-deploy workflow cannot reactivate the old stack during or after cutover.
- Preserve authorization, trusted client-IP ingress, session cookies, GitHub webhook signatures, remote MCP, artifact ownership and release-policy mount checks.
- A missing required secret, unverified volume, unverified OAuth ingress contract or unprotected rollback is a stop condition.

## Single-stack production cutover

1. Fence inbound writes and workers using the existing operations procedure, then stop the previous Compose services without -v. Keep the previous container image and the volumes. Never run old and new against the same volumes.
2. Configure verified runtime secrets and mount paths in Coolify, then deploy the single production application. Migration must succeed before web and worker start. Check that exactly one web, worker, PostgreSQL, Redis and Cloudflare Tunnel are active for this installation.
3. Verify the public HTTPS endpoints, application and worker health, database schema, OAuth consent/authorization, webhook delivery, GitHub App access, release policy, and artifact permissions.
4. Enable GitHub-triggered Coolify deploy only after verified acceptance and after retiring the legacy deploy route. No separate persistent pre-production environment is needed.

If Coolify deployment fails, stop its containers without deleting volumes. Assess migration backward compatibility before restarting the old image; forward-only schema changes may require a verified data restore. No host-wide Docker prune or volume deletion is part of cutover.

## Offline syntax check

Copy the Compose file into a disposable directory, provide only dummy nonproduction environment values and a local .env, then run:

    docker compose --env-file .env -f docker-compose.coolify.yml config --quiet

This does not deploy or run migrations. A successful parse is not evidence of working production OAuth, ingress or artifact recovery.
