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

## Numeric original USER source-row attribution — seven hardware classes

A separate **SOURCE-ONLY / COUNT-ONLY** PostgreSQL preflight now
inspects the following seven classes from the hardware track using
the exact immutable GitHub numeric USER on a pending uninstall export,
its matching suspended USER installation and repository/run relationships:
`boards`, `board_bom_snapshots`, `board_bom_components`,
`repository_firmware_snapshots`, `repository_firmware_dependencies`,
`repository_firmware_advisory_watch` and `run_pcb_footprint_summaries`.
All seven remain **Not verified / DENY for customer disclosure**; this
preflight merely discovers bounded retained source-row counts (0–100
per class). It does NOT inspect or return BOM values, repository names,
firmware metadata, design files, private identifiers or row IDs.
Unknown owner, non-suspended installation, active tenant legal hold,
real erasure or crossed foreign-repository run references reject the
entire candidate. PostgreSQL returns counts in one consistent
read-only snapshot. A zero count is NOT proof of archive completeness
and a nonzero count is NOT a license to disclose. The remaining 12
hardware-track classes are not yet covered by this row-attribution
preflight. The future independently signed complete DB+filesystem
export and customer authorization remain blocked.

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
