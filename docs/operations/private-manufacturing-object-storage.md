# Private manufacturing archives — VPS-independent transfer (opt-in)

BoardReadyOps can prepare a private, **source-bound** manufacturing archive transfer that never POSTs the large archive to its web API. This is source-only migration infrastructure: **do not enable it in production until the go/no-go conditions below pass on the actual provider.** It does not authorize fabrication or customer sharing.

## User flow

1. The authorized GitHub Actions runner builds an exact-source manufacturing `.tar.gz` with the manifest and detached Sigstore attestation.
2. With repository variable `BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE=true` and web flag `BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE_ENABLED=true`, the runner authenticates to the existing BoardReadyOps endpoint using the stored run/attempt/repository GitHub OIDC audience, then posts **only** a small JSON digest and size.
3. The server returns a short-lived, SHA-256/length/content-type-signed **PUT** to a branch-owned private Neon Object Storage bucket under `pending/<run>/<attempt>/<upload>.tar.gz`. No storage credential reaches the runner.
4. After the runner uploads bytes directly, a second OIDC-authenticated JSON callback proves possession of the 10-minute signed ticket. The server copies the object to the separate `verified/<run>/<attempt>/<artifact>.tar.gz` namespace that the runner cannot select or write, reads actual bytes, verifies length, SHA-256, safe archive entries, signed manifest and Sigstore evidence, and only then records the canonical signed evidence in PostgreSQL.
5. Existing repository-scoped signed first-party links and authorized guest capabilities can request download. The server checks stored metadata and writes the access audit, then issues a **60-second private S3 GET redirect**. A private bucket is mandatory. The user verifies the displayed SHA-256 against the downloaded `.tar.gz`. This is not manufacturing approval.

Legacy `MANUFACTURING_ARCHIVE_STORAGE=local`, `github-actions`, local artifact routes, older receipts and artifact bytes remain unchanged when the new flag is off.

## Required runtime configuration (not yet provisioned)

- `BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE_ENABLED=true` only after acceptance.
- `NEON_OBJECT_STORAGE_ENDPOINT`: the **actual** current branch S3 endpoint, with no URL path or query. It must use HTTPS and end in `.storage.c-<cell>.<region>.aws.neon.tech`.
- `NEON_OBJECT_STORAGE_BUCKET`: private (not `public_read`) bucket on the correct production branch, with branch-scoped `storage:read` and `storage:write` credentials.
- `NEON_OBJECT_STORAGE_ACCESS_KEY_ID`, `NEON_OBJECT_STORAGE_SECRET_ACCESS_KEY`, `NEON_OBJECT_STORAGE_REGION`: server-only credentials, never injected into the target GitHub workflow or client pages.
- `ARTIFACT_DOWNLOAD_SIGNING_KEY`: existing server signing key; do not rotate it casually because older signed links depend on it.
- Target repository's `BOARDREADYOPS_MANUFACTURING_OBJECT_STORAGE=true` opt-in. **Do not** also enable `BOARDREADYOPS_MANUFACTURING_TEMP_ARTIFACTS=true`. The canonical workflow must be installed in that repository by its authorized owner; updating this repository does not automatically update downstream workflow copies.

Use the existing authenticated Github App/Neon connection; this does not require another Vercel account, staging environment, new database schema or separate runner.

## Acceptance and cost HOLD — no go-live without all items

- Confirm **real Neon S3 interoperability** of presigned `PUT` with signed SHA-256 and Content-Length, private bucket, provider COPY, signed GET, 128 MiB cap, and all applicable regional/account free quotas. Unit mocks and actionlint are not a substitute.
- Check private byte access from the same production branch credentials, correct repository+attempt OIDC, and that wrong/expired/replayed tickets cannot publish. Test an actual (authorized) signed KiCad export and independent SHA-256 match after download; no manufacturing release claims from fixtures.
- Confirm Next/Vercel execution time, temp-disk size and Neon-to-function transfer for full **up-to-128 MiB** verification, or lower the limit to an empirically safe bound. Vercel's 4.5 MiB request/response limit is bypassed by direct upload, but **verification still reads bytes inside the function**, and `tar` and Sigstore verification must work in the target runtime.
- **Retention / orphan cleanup remains a blocker:** Neon Object Storage does not enforce S3 lifecycle policies. Failed uploads leave `pending/` objects. Before production activation, implement and verify bounded age-based pending cleanup and storage quota alerts, while preserving legal holds, evidence-referenced `verified/` objects, audit history and safe deletion. The existing local artifact-deletion worker is NOT a Neon object-store janitor.
- A 60-second presigned GET can remain usable for up to 60 seconds after app-side access revocation. This is a deliberate bound to review against customer sharing/legal-hold policy; stricter immediate revocation requires a different download delivery contract.
- Check CORS/redirect and content security policy if the download is consumed by browsers. Verify private buckets cannot be anonymous GET/read.
- Failure injection: wrong source/tenant, expired ticket, changed bytes, S3 copy failure, mid-stream disconnect, revoked GitHub installation, SQL acknowledgement dropped after commit, interrupted retry, and offline provider. Never delete the verified object after **ambiguous** SQL acknowledgement.
- Validate GitHub Actions runtime/quota, database retention and branch-scoped credential/bucket availability. No surprising paid tier or persistent staging.
- Complete a full authorized source → signed Check Run → BOM/Gerber download flow, verify the downloaded hash, assess real customer usability, then separately commission single-environment cutover and VPS retirement.

When any acceptance condition fails, keep both feature switches OFF and leave the existing VPS/volume in service. Do not attempt automatic legacy data migration or unlink existing files.

Reference: [temporary GitHub Actions archives](temporary-manufacturing-archives.md).
