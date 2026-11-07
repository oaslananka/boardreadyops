# Historical original GitHub USER — unresolved source class review queue

**SOURCE-ONLY / NO CUSTOMER DISCLOSURE / NO_GO.** This file accounts for
all **63** PostgreSQL table classes not in the 13 redacted partial-metadata
candidates or 16 deliberately withheld sensitive classes. These are
**review tasks**, not approved customer export classes. Table names are
schema identifiers only; no rows, original-user IDs, tokens or private
source data are read by this register.

A matching schema fingerprint proves schema names/types have not drifted;
it does not prove a row belongs to a particular original numeric GitHub
USER or that the user may lawfully receive third-party/hardware content.
Ownership must be linked by authoritative immutable keys, not a recycled
login. Each track needs independent, test-backed provenance, redaction,
rights, retention/hold/erasure and cross-store checks before any class
can be proposed for inclusion in a future complete signed export.

| Review track | Tables | Pending evidence |
| --- | ---: | --- |
| `privacy_lifecycle` | 17 | Original numeric USER/uninstalled installation; active retention, legal hold and erasure; prevent disclosing internal reservation/nonces/tokens or audit identifiers |
| `billing_and_marketplace` | 5 | Provider contractual rights, financial/PII redaction, original account identity independently bound (not recycled login), tax/retention requirements |
| `hardware_and_release` | 19 | Original repository ownership, source permissions, artifact manifests, collaborators/design IP, third-party license and contributor consent |
| `collaboration_and_workspace` | 10 | Distinct workspace/repository grants, membership and invitation provenance, multi-user privacy/PII rights, review/policy scope and historical account bindings |
| `platform_operations` | 12 | Tenant versus platform-owned boundary, service internal/worker credentials, platform audit and retry metadata, retention and customer-vendor disclosures |

## Independent PostgreSQL foreign-key lineage inventory — 2026-11-07

Read-only, **schema-only**, repeatable-read assessment of all 63 unresolved
classes after migrations through **0126**, tested on disposable PostgreSQL 17.
The audit first verifies that the exact **92 declared public tables**
are present with no additional table, then inspects **123 public
foreign-key constraints** in the SAME read-only snapshot and checks only
whether a table has an enforced *structural path* to the \`installations\`
table. It **never queries application table rows, customer/source content,
numeric user IDs, artifact bytes or billing data**. This is a triage aid,
**not** a verified historical GitHub USER owner, tenant, legal/IP right or
customer export manifest. The standalone diagnostic is
\`assessHistoricalUserUnresolvedSourceLineage\`; its return type hard-codes
\`NO_GO\`, \`completeCustomerExport=false\` and
\`customerDeliveryAllowed=false\`.

| Review track | With some FK path to \`installations\` | **No FK path** | Customer disclosure |
| --- | ---: | ---: | --- |
| \`privacy_lifecycle\` | 4 | **13** | DENY |
| \`billing_and_marketplace\` | 0 | **5** | DENY |
| \`hardware_and_release\` | 19 | 0 | DENY |
| \`collaboration_and_workspace\` | 2 | **8** | DENY |
| \`platform_operations\` | 9 | **3** | DENY |
| **Total** | **34** | **29** | **DENY for all 63** |

The following **29** classes have **no FK path** to an installation in
the pinned database schema and therefore need an *independent, historical,
immutable owner-linkage review* before completeness can even be evaluated.
Absence of an FK does **not** mean the rows are foreign-owned or irrelevant:
some source classes may use intentionally unbound original-user IDs, signed
export references, application-level joins, or platform-wide retention. In
particular, \`data_exports\` is intentionally able to have an absent
\`installation_id\` after uninstall; a fresh installation or recycled login
must **not** be used as a substitute owner proof.

- **Privacy/lifecycle (13):** \`artifact_export_copy_reservations\`,
  \`artifact_unlink_fences\`, \`data_export_archive_commitments\`,
  \`data_exports\`, \`erasure_requests\`,
  \`historical_user_live_oauth_verified_proofs\`,
  \`historical_user_oauth_challenges\`,
  \`historical_user_partial_cleanup_events\`,
  \`historical_user_partial_read_reservations\`,
  \`historical_user_private_delivery_preflights\`,
  \`historical_user_private_preflight_events\`, \`legal_holds\`,
  \`retention_policies\`.
- **Billing/marketplace (5):** \`billing_activity\`, \`billing_customers\`,
  \`billing_events\`, \`billing_subscriptions\`,
  \`github_marketplace_subscriptions\`.
- **Workspace/collaboration (8):** \`product_events\`, \`projects\`,
  \`review_policies\`, \`review_policy_audit_events\`,
  \`workspace_member_audit_events\`, \`workspace_members\`,
  \`workspace_memberships\`, \`workspaces\`.
- **Platform operations (3):** \`cloud_schema_migrations\`,
  \`component_lifecycle_observations\`, \`control_plane_jobs\`.

Even among the **34 with an FK path**, joins may be nullable, legacy rows
may be detached, a path may cross multiple workspaces, and artifacts can
carry third-party rights. For example, \`boards → repositories →
installations\` is structurally joined with non-null FKs, while the
observed path for \`manufacturing_share_authorizations → release_runs →
repositories → installations\` contains at least one nullable reference:
**neither path alone establishes historical USER identity or redistribution
rights**. All 19 hardware classes still require the existing, separate
original-numeric-user, owner/run/revision/share consistency vetoes and
legal/IP review. No source is automatically included in a customer ZIP.

This evidence shortens the next review: verify independent owner provenance
for the **29 unlinked** classes, then separately establish retained-row
coverage, all collaborator/vendor disclosure rights, live hold/erasure
checks and DB+physical-object integrity for every potentially eligible
class. The diagnostic must never become a customer delivery gate on its
own; no migration, endpoint, scope allowlist or customer permissions were
added here.

## Original-user export request records: numeric-owner candidate review

The `data_exports` table is one of the **29 without a foreign-key path**
to `installations`, and this lack of a path is intentional for suspended
original GitHub USER accounts (`installation_id IS NULL`). Migration `0115`
preserves `original_github_user_id` only when the original signed GitHub
uninstall event supplied a numeric identity. Historical login-only records
are deliberately **not backfilled**, since a username can be reused.

The private, read-only `assessHistoricalUserExportIdentityReview` makes this
specific ownership gap explicit. Inside a single PostgreSQL
`REPEATABLE READ READ ONLY` transaction, it first enforces the existing
original **numeric GitHub USER + pending uninstall export + suspended USER
installation** predicate and current hold/erasure exclusions. It then
counts at most **100** nearby export records in five disjoint review
categories: matching numeric owner and login, matching numeric owner under a
different historical login, login-only unbound legacy requests, another
numeric USER with the *same* login, and other same-login lifecycle records.
The query returns counts **only**; it never selects an export ID list,
download URL, manifest, physical artifact, OAuth proof, personal content
or third-party data. A missing source, invalid count or excess scope
fails closed.

The independently verified numeric ID is required for any positive
attribution; a reused login or a null numeric owner is **never** treated
as proof. Records found under a previous login remain *review candidates*,
not automatically eligible content. Disposable PostgreSQL adversarial tests
include two suspended accounts with the same login, historical login-only
data, an alias-changed original USER, and live legal-hold/erasure vetoes.

This closes **no customer disclosure or completeness requirement**.
It neither proves that all pre-0115 legacy records belong to the original
USER nor authorizes redistribution, other 28 no-FK classes, or a full
DB-plus-physical-object snapshot. Every result retains
`completeCustomerExport=false`, `customerDeliveryAllowed=false`,
`independentOwnershipComplete=false` and `releaseDecision=NO_GO`.
No schema migration, customer endpoint or delivery feature is added.

## Four tenant-login-only lifecycle classes: ambiguity and bounded count review

The private `assessHistoricalUserTenantOnlyLifecycleCandidates` now
examines **four more** of the remaining 28 FK-unlinked classes:
`retention_policies`, `legal_holds`, `erasure_requests` and
`product_events`. All four use a tenant/login string rather than
an immutable original numeric GitHub USER ownership FK. One read-only,
repeatable-read transaction verifies the original pending uninstall export
and matching suspended numeric USER installation, with active hold and
non-dry-run erasure vetoes. It returns only bounded **candidate counts**
(up to 100 per class) and a boolean indicating whether an installation
with that login has a *different or unknown* numeric USER identity.
No record IDs, reasons, policy text, actors, personal fields or event
payloads are selected. Over 100 candidates for **any** class, malformed
counts or missing authority fails closed rather than truncating evidence.

These counts are **not original-user ownership assignments**: even
without a detected competing installation, a tenant string is reusable,
legacy rows can be detached and a private hold or event may be platform-
or third-party-owned. With an active hold or an in-progress/completed
non-dry-run erasure, the existing owner-authority predicate refuses
the entire review before any candidate evidence is returned. Disposable
PostgreSQL tests cover same-login different numeric USER identities,
foreign-tenant isolation, hold/erasure vetoes and the over-100 cap.

After the separate `data_exports` review, these four classes are
**triaged but still NOT cleared for customer disclosure**. The other
**24 FK-unlinked classes** remain without a dedicated owner-evidence
review. All 63 original-user source classes are still DENY; any future
complete export also needs independent immutable provenance, multi-party
IP/privacy rights, full signed DB+physical-object coherence and audited
OAuth delivery. No migration, public route, export whitelist, tokens or
customer permission were added.

## Billing and GitHub Marketplace — numeric account versus reusable tenant

The five **FK-unlinked** billing classes now have a single bounded internal
source candidate review, ~assessHistoricalUserBillingOwnershipCandidates~.
It is anchored to the existing original **numeric GitHub USER** authority
and pending uninstall export, and reads in one ~REPEATABLE READ READ ONLY~
snapshot. It counts the four tenant-login-only classes
~billing_customers~, ~billing_subscriptions~, ~billing_events~ **with
a tenant ID**, and ~billing_activity~ (each at most 100 candidates)
separately from ~github_marketplace_subscriptions~. The latter has a
**numeric GitHub account ID**, allowing exact account-ID matches to be
distinguished from *different* numeric accounts that share a recycled
login, or an exact numeric account under a different historical login.
One boolean also reports a competing/unknown numeric GitHub USER
installation for the original login. The query selects **no provider
payload, financial amount, billing customer ID, Stripe ID, event content,
receipt, account number, raw record identifier or external URL**.

An exact Marketplace numeric ID is useful **identity evidence for that
Marketplace row only**, not permission to release provider invoices,
payment events, subscription information, or records of other users.
~billing_events~ with a **NULL tenant_id** remain untraceable by this
review and are explicitly declared **unresolved**, rather than silently
counted as absent. The four tenant-login classes cannot be attributed
to a historical numeric USER by username alone; an unaffected login can
still have changed ownership in the past. A 101st candidate for any
class fails closed, as do expired/orphan exports, competing authority,
live legal holds and destructive erasures. Tests use entirely synthetic
records on disposable PostgreSQL and verify both numeric collisions,
tenant isolation, missing billing tenant and the bound.

This is the second grouped inspection after the previous tenant-only
lifecycle review: **10 of 29** no-FK classes now have a dedicated
internal candidate review, while **19** still lack one. **Zero** of the
63 unresolved classes has passed the required customer ownership,
privacy and redistribution rights acceptance. Provider contracts,
retention, billing/PII disclosure, source completeness, DB+physical
object integrity and real OAuth customer authorization must be
reviewed independently. No migration, public endpoint, export whitelist,
billing credential, provider API call or customer ZIP was introduced.

## Shared workspaces, projects, grants and append-only policy audit — seven-class candidate review

A separate internal, read-only `assessHistoricalUserWorkspaceCandidates`
now covers **seven** more classes lacking an FK path to a GitHub
installation: `workspaces`, `projects`, `workspace_members`,
`workspace_member_audit_events`, `workspace_memberships`,
`review_policies` and `review_policy_audit_events`.

Under the **original numeric GitHub USER** authority (still-pending
uninstall export, original suspended USER installation and current
hold/real erasure veto), one `REPEATABLE READ READ ONLY` transaction
returns **eleven bounded counts**. It separates: workspaces and
projects joined through an explicitly *numeric* member; legacy
`workspace_members` with a NULL GitHub ID and reused login; audit
events whose *actor* or *subject* matches the original numeric user;
tenant-login-only seat memberships and review policies; and policy
audit events acted on by the numeric user versus a **different**
numeric user within the reused tenant. Counts cap at 100 each, a 101st
candidate fails closed, and a separate boolean flags competing/unbound
installation identities under the login. Only counts and a boolean
are returned — **no** user details, membership identifiers, project
contents, before/after policy JSON, CAD files, email, audit content,
sharing tokens or archive bytes are selected.

These are **potential involvement references, NOT proof of ownership**:
being a member of a workspace never confers rights to export its projects,
all collaborators' CAD designs, signed evidence, other members or audit
history. An actor or subject numeric ID only identifies the person
named in that event, not the owner of the event's complete payload.
A login-only legacy row cannot be reassigned to the present account;
no visible conflict also does not establish sole historic ownership.
Deleted-workspace orphan audit events or workspaces with no retained
member are explicitly **not proven absent** by this query. Physical
archives and delivery rights remain outside this review.
The append-only audit triggers remain unchanged; PostgreSQL tests use
a disposable database and remove its container instead of deleting
audit history.

With the earlier numeric export, four tenant lifecycle and five billing
candidate reviews, **17 of 29** FK-unlinked classes now have *internal*
bounded candidate-assessment evidence; the remaining **12** lack a
dedicated provenance assessment. **All 63 classes stay DENY/NO_GO**.
Neither this review nor its exact numeric identity matches grant
multi-party redistribution, customer ZIP, legal/IP rights or completeness.
No migration, new public endpoint, permanent worker, export allowlist,
new dependency or paid infrastructure was added.

## Individual table review queue

### Privacy, export lifecycle and installation authority — 17 tables

Required independent review: Original numeric USER/uninstalled installation; active retention, legal hold and erasure; prevent disclosing internal reservation/nonces/tokens or audit identifiers.

| Table | Review status | Customer export permission |
| --- | --- | --- |
| `artifact_deletion_jobs` | Not verified | DENY |
| `artifact_export_copy_reservations` | Not verified | DENY |
| `artifact_unlink_fences` | Not verified | DENY |
| `data_export_archive_commitments` | Not verified | DENY |
| `data_exports` | Not verified | DENY |
| `erasure_requests` | Not verified | DENY |
| `historical_user_live_oauth_verified_proofs` | Not verified | DENY |
| `historical_user_oauth_challenges` | Not verified | DENY |
| `historical_user_partial_cleanup_events` | Not verified | DENY |
| `historical_user_partial_read_reservations` | Not verified | DENY |
| `historical_user_private_delivery_preflights` | Not verified | DENY |
| `historical_user_private_preflight_events` | Not verified | DENY |
| `historical_user_snapshot_mutation_epochs` | Not verified | DENY |
| `installations` | Not verified | DENY |
| `legal_holds` | Not verified | DENY |
| `repository_retention_policies` | Not verified | DENY |
| `retention_policies` | Not verified | DENY |

### Billing and marketplace records — 5 tables

Required independent review: Provider contractual rights, financial/PII redaction, original account identity independently bound (not recycled login), tax/retention requirements.

| Table | Review status | Customer export permission |
| --- | --- | --- |
| `billing_activity` | Not verified | DENY |
| `billing_customers` | Not verified | DENY |
| `billing_events` | Not verified | DENY |
| `billing_subscriptions` | Not verified | DENY |
| `github_marketplace_subscriptions` | Not verified | DENY |

### Hardware, manufacturing and release provenance — 19 tables

Required independent review: Original repository ownership, source permissions, artifact manifests, collaborators/design IP, third-party license and contributor consent.

| Table | Review status | Customer export permission |
| --- | --- | --- |
| `board_bom_components` | Not verified | DENY |
| `board_bom_snapshots` | Not verified | DENY |
| `board_supply_findings` | Not verified | DENY |
| `board_supply_watch` | Not verified | DENY |
| `boards` | Not verified | DENY |
| `manufacturing_share_authorizations` | Not verified | DENY |
| `production_batch_defects` | Not verified | DENY |
| `production_batches` | Not verified | DENY |
| `protected_release_execution_seals` | Not verified | DENY |
| `protected_release_intent_candidates` | Not verified | DENY |
| `release_run_attempts` | Not verified | DENY |
| `release_run_results` | Not verified | DENY |
| `release_run_transition_events` | Not verified | DENY |
| `repository_firmware_advisory_watch` | Not verified | DENY |
| `repository_firmware_dependencies` | Not verified | DENY |
| `repository_firmware_snapshots` | Not verified | DENY |
| `run_pcb_footprint_summaries` | Not verified | DENY |
| `signed_manufacturing_export_evidence` | Not verified | DENY |
| `supply_finding_suppressions` | Not verified | DENY |

### Workspace, product and collaboration — 10 tables

Required independent review: Distinct workspace/repository grants, membership and invitation provenance, multi-user privacy/PII rights, review/policy scope and historical account bindings.

| Table | Review status | Customer export permission |
| --- | --- | --- |
| `external_review_invitations` | Not verified | DENY |
| `product_events` | Not verified | DENY |
| `projects` | Not verified | DENY |
| `review_policies` | Not verified | DENY |
| `review_policy_audit_events` | Not verified | DENY |
| `revisions` | Not verified | DENY |
| `workspace_member_audit_events` | Not verified | DENY |
| `workspace_members` | Not verified | DENY |
| `workspace_memberships` | Not verified | DENY |
| `workspaces` | Not verified | DENY |

### Control plane, notifications and operational diagnostics — 12 tables

Required independent review: Tenant versus platform-owned boundary, service internal/worker credentials, platform audit and retry metadata, retention and customer-vendor disclosures.

| Table | Review status | Customer export permission |
| --- | --- | --- |
| `cloud_schema_migrations` | Not verified | DENY |
| `component_lifecycle_observations` | Not verified | DENY |
| `control_plane_jobs` | Not verified | DENY |
| `control_plane_outbox` | Not verified | DENY |
| `control_plane_reconciliation_items` | Not verified | DENY |
| `control_plane_replay_operations` | Not verified | DENY |
| `deliveries` | Not verified | DENY |
| `notification_channels` | Not verified | DENY |
| `notification_deliveries` | Not verified | DENY |
| `repository_setup_probes` | Not verified | DENY |
| `repository_setup_revisions` | Not verified | DENY |
| `runner_execution_policies` | Not verified | DENY |

## Numeric original USER source-row attribution — nineteen hardware classes

A **SOURCE-ONLY / COUNT-ONLY** PostgreSQL diagnostic now inspects bounded,
relationally attributable candidates across all **19 hardware-track table
classes**, under the exact numeric GitHub USER of a pending uninstall export,
its suspended USER installation, owned repositories and release runs.
It includes boards/BOM, firmware, PCB footprints, supply watch/findings and
suppressions, production batches/defects, release attempt/results/transitions,
protected release intent/seals, signed manufacturing evidence, and
`manufacturing_share_authorizations`.

The manufacturing-share class is **not** attributed by
`projects.github_repo_full_name` alone: that name can change or be
reused. A count is allowed only if the share's original numeric GitHub
author, workspace/revision, immutable owned run, release attempt,
manufacturing artifact, project-name consistency, source commit/archive
digest and independently bound signed manufacturing evidence all agree.
A share linked to the original USER's run or artifact but mismatching
author, revision, workspace, run, artifact, source digest or signed
evidence **rejects the entire diagnostic**. A former USER's share
with a deleted run/artifact link is likewise denied rather than
silently counted as complete. Another USER's unrelated private
workspace/repository shares are excluded.

**19/19 is a count-join review surface, NOT 19/19 source completeness
or customer export eligibility.** Legacy shares can have both
`run_id` and `artifact_id` set to NULL on reference deletion;
other people's workspace shares may be impossible to link to a former
installation. Those ambiguous or untraceable rows, third-party
author/revocation history and original-author redisclosure rights are
**not proven complete or lawful** by this bounded relational count.
The mutable project name is an additional consistency veto, never
affirmative identity authority. No historical GitHub session/ownership
proof, legal/IP analysis or collaborator permission can be inferred
from a matching count.

All nineteen classes remain **NOT VERIFIED / DENY for customer disclosure**.
Counts are limited to 0–100 per class, and any unknown/ambiguous source,
foreign repository/installation, active legal hold, real erasure, or
missing/malformed SQL response fails closed. The transaction uses one
consistent PostgreSQL snapshot; it is **not** an atomic
database-plus-filesystem export. Neither raw BOM values, source IP,
personal names, tokens, private row IDs, binary artifacts nor ZIP bytes
are disclosed. `completeCustomerExport=false`,
`customerDeliveryAllowed=false`, `sourceRightsVerified=false`
and `thirdPartyDisclosureRightsVerified=false` remain immutable
NO_GO decisions in this diagnostic. The future independently signed
complete DB+physical-storage snapshot and separate revocable customer
delivery authorization are still blocked.

## Acceptance conditions (not met)

The source-only 13-table partial metadata preview is not a complete source
extract. The 16 deliberately withheld classes cannot silently be published,
and the 63 items above have no independently verified scope decision.
Current Ed25519 evidence covers only a verified partial ZIP; live OAuth
diagnostic proves original account identity, not artifact or third-party
disclosure rights. A future customer-ready archive additionally requires
a coherent independently signed database and physical storage snapshot,
documented completeness across all eligible classes, a separate revocable
customer-delivery entitlement and real OAuth/shared-worker/crash E2E.
Neither this table register nor the PostgreSQL schema coverage guard can
change `completeCustomerExport=false` or `customerDeliveryAllowed=false`.
