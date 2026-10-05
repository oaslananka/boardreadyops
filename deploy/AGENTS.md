# Deployment Instructions

These instructions apply to `deploy/**` and supplement the repository root instructions.

Deployment assets describe generic BoardReadyOps runtime topology. Environment/provider commissioning details belong in the private `oaslananka/boardreadyops-infra` repository.

## Production boundary

- Do not commit secret values, production credentials, database connection material, or host-specific sensitive data.
- Managed configuration remains authoritative where the commissioned runbook uses it.
- Verify the commissioned runbook before changing host, service, or mount expectations; do not infer production topology from stale documentation.
- Keep web, worker, migration, database, cache, proxy/tunnel, and policy-mount responsibilities explicit.

## Mutation and rollback

- Rehearsal or dry-run paths must not mutate running production services.
- Real deploys require explicit operator intent.
- Preserve rollback artifacts and images according to the documented keep-set.
- Destructive storage/database maintenance requires separately reviewed recovery evidence.
- A deployment change is incomplete until post-deploy health and security verification matches the documented contract.

## Network and runtime policy

- Do not broaden inbound exposure for the customer runner; runner operation remains outbound-only.
- Keep TLS, security-header, and release-policy mount verification fail-closed where currently enforced.
- Generic examples must not contain production-specific sensitive values.

## Verification

Run the relevant compose/config validators, safe rehearsal paths, and workflow/security linters for any coupled automation change.
