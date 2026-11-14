# Temporary manufacturing downloads — Free Beta staging

BoardReadyOps supports an **opt-in, three-day GitHub Actions archive mode** for signed manufacturing evidence. It is not enabled in Production by this change. BOM/Gerber/drill files and the detached signature bundle are included in the temporary export archive. BoardReadyOps stores the immutable SHA-256, source and signer SHAs, signature subject inventory digests and exact GitHub workflow identity in PostgreSQL; it does **not** store the temporary archive on its own persistent filesystem.

## Enable together only after a real source-bound test

- Set the trusted BoardReadyOps web runtime `MANUFACTURING_ARCHIVE_STORAGE=github-actions`.
- Install the **updated** canonical `.github/workflows/readiness-runner.yml` into an explicitly authorized test hardware repository. Existing installed workflows are not updated automatically. Set its repository variable `BOARDREADYOPS_MANUFACTURING_TEMP_ARTIFACTS=true` (not a secret).
- Use the existing GitHub App installation with Actions **read** permission and the configured short-lived OIDC identity; do not add an API token. The webhook-authenticated cloud importer verifies the GitHub Actions artifact belongs to the stored repository and exact workflow run **before** storing metadata.
- Sign and upload the exact source-bound export. The Actions workflow keeps a GitHub-hosted ZIP wrapping `boardreadyops-manufacturing-export.tar.gz` for at most **3 days**. The archive is size-checked against the existing 128 MiB import limit. Failed uploads must not record a downloadable file.
- The Run's Artifacts view points an authorized user to GitHub. The user signs into GitHub, downloads the ZIP, extracts the `.tar.gz` and checks the SHA-256 reported in BoardReadyOps **against the `.tar.gz`**, not against GitHub's wrapper ZIP. The archive and its signing material should be verified prior to any fabrication decision; no readiness approval is inferred merely from a successful download.
- After 72 hours the UI removes the link and marks the file *expired*. GitHub organization retention rules, manual deletion or disabled Actions can remove it **earlier**. Actual GitHub availability cannot be guaranteed from a stale DB record. To obtain a new file, rerun the source-bound workflow at the **exact reviewed commit**, rechecking release policy and attestation; a regenerated archive will have a new digest.

## Preserve existing production and stop boundaries

When the env flag is unset, the existing local archive storage mode is unchanged. No existing disk artifacts, signed manufacturing receipts, issued delivery links or customer history are deleted. No migration, DNS cutover or provider apply is triggered.

This mode intentionally **does not** support guest manufacturing shares or the legacy signed-download API for temporary GitHub URLs: access requires repository GitHub permissions, and the legacy API fails closed instead of pretending to stream local bytes. Other runner-uploaded artifacts, data-export archives, local retention/deletion workers and the continuously running control-plane worker still need their own bounded serverless redesign. **VPS cannot be retired solely because this archive mode passes.**

Operator acceptance: run the canonical workflow with a real clean repository, independently verify the signed manifest and ZIP SHA, confirm metadata scoped to the right run/repository, download while live, verify expiry and failures, and inspect GitHub storage/quota use under the repository's actual plan.
