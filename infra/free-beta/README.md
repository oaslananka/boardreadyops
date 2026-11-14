# Free Beta infrastructure blueprint (not production)

This is an **opt-in, uncommissioned** OpenTofu template for an isolated Vercel/Neon staging environment. It creates **nothing** by default. All existing Coolify/PostgreSQL/worker/domain resources remain untouched. Provider-specific commissioning and encrypted remote state belong in the private infrastructure repository defined by the project's deployment policy; this public template deliberately contains neither production identity nor secrets.

## Inspect without making changes

With OpenTofu installed, run from this directory:

~~~sh
tofu fmt -check
tofu init -backend=false
tofu validate
tofu plan
~~~

A plan requires provider tokens even with no resources. Supply them through environment variables (VERCEL_API_TOKEN and NEON_TOKEN), not files or CLI arguments. No provider credentials are required for fmt/validate. With `provision=false`, the plan must report **no resource changes**. In particular, this file does **not** provision a paid provider tier, connect a GitHub repository, point `boardreadyops.com` anywhere, run migrations, provision a worker, or expose source files. No `tofu apply` is part of this runbook.

## Commissioning prerequisites (not yet met)

The target team and organization are deliberately *not guessed* from provider token scope. To enable provisioning in a privately managed environment, explicitly provide `vercel_team_id` and `neon_org_id` for verified eligible accounts; with `provision=true`, missing IDs stop at variable validation. Region defaults to the existing account's EU-Central region but must be approved before any apply. Do not copy production database credentials or import a production project into this staging state.

Before ever switching `provision=true`: verify that the specific Vercel account is eligible for **personal/noncommercial Hobby use** (removing payment buttons does not automatically establish that eligibility); verify Neon account and project free quotas; create **private remote state with locking** outside this repository; confirm Vercel Git integration or deploy process with a non-production branch; securely configure the app's GitHub authentication, separate Neon `DATABASE_URL`, and required web runtime credentials **outside IaC state**. Never commit token values, database URLs, state files, tfvars with sensitive values or generated plans.

Then independently implement and test: serverless-safe request and artifact size limits; durable object storage for manufacturing ZIPs, signed manifests and data exports; replacement of the continuously polling control-plane worker; database connection pooling and zero-unverified-release handling. A Vercel function has an ephemeral file system and cannot substitute for this worker or artifact volume. Until the real source-bound signed hardware user journey passes, **do not switch DNS or decommission VPS**.

Official reference: https://vercel.com/legal/terms and https://neon.com/docs/introduction/plans .