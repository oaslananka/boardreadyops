# Launch Checklist

This is the cross-functional evidence checklist for BoardReadyOps Cloud promotions. Owning GitHub issues/ADRs remain authoritative for implementation detail.

## Launch record

For each promotion create a dated record containing:

- target environment;
- release/commit/deployment identity;
- promotion level: internal / design partner / public beta / GA;
- reviewer/owner roles;
- linked evidence;
- known accepted risks;
- rollback criteria;
- final GO / NO-GO decision.

## A. Repository and release integrity

- [ ] Required security and release-health checks are green.
- [ ] Current package/release references are accurate.
- [ ] Supported Node/KiCad/toolchain versions are documented and tested as claimed.
- [ ] Dependency vulnerability gates are active.
- [ ] Release artifacts/provenance/checksums are generated and verified as intended.
- [ ] Publishing authentication state matches documented Trusted Publishing plan.

## B. Control-plane reliability

- [ ] Webhook acceptance is authenticated and durable.
- [ ] Duplicate webhook delivery is idempotent.
- [ ] Jobs/outbox survive web/worker restart.
- [ ] Retry behavior is bounded and observable.
- [ ] Dead-letter/reconciliation procedures are tested.
- [ ] Transition writers preserve legal state-machine behavior.
- [ ] Backup exists for intended production configuration.
- [ ] Restore drill succeeds from a clean target.
- [ ] RPO/RTO are measured and within stated objectives.
- [ ] Expected load/soak stays within operational thresholds.
- [ ] Failure injection shows no duplicate irreversible side effect or ambiguous terminal state.
- [ ] Runbooks match actual deployment configuration.

## C. GitHub App and hosted execution trust

- [ ] Production GitHub App manifest is final for launch scope.
- [ ] Every permission/event has a documented reason.
- [ ] Product/Marketplace/security copy matches actual permissions.
- [ ] Target-repository workflow is the reviewed supported version.
- [ ] Exact target SHA validation is active.
- [ ] Checkout credentials are not persisted unnecessarily.
- [ ] Private/fork safe-execution policy is tested.
- [ ] Callback origin/path validation is tested.
- [ ] GitHub OIDC tokens are validated for required claims/bindings.
- [ ] Replay from previous attempts is rejected.
- [ ] Wrong installation/repository/workflow/ref/event/environment/run/attempt/SHA is rejected as applicable.
- [ ] Two real installations complete end-to-end isolation validation.
- [ ] Isolation evidence contains no secrets/private tenant data.

## D. Tenant authorization and data lifecycle

- [ ] Every customer-owned entity is scoped to intended tenant boundary.
- [ ] Cross-tenant API/database negative tests pass.
- [ ] Artifact/evidence authorization negative tests pass.
- [ ] Large artifact bytes bypass web/dashboard process.
- [ ] Signed access URLs are short-lived/bounded.
- [ ] Artifact retention behavior is documented.
- [ ] Artifact deletion behavior is documented/tested.
- [ ] Account/installation deletion effects are defined.
- [ ] Backup/retention interaction is documented.
- [ ] Privacy docs match stored data.

## E. Product onboarding and UX

- [ ] Fresh user can sign in/authenticate through supported path.
- [ ] Fresh installation can select/enable a representative repository.
- [ ] Workflow setup has no hidden maintainer-only step.
- [ ] First run produces understandable state.
- [ ] Common failure states show actionable recovery.
- [ ] User can reconnect/refresh and recover run status.
- [ ] Findings explain why they matter and link evidence.
- [ ] Authorized evidence/artifacts are accessible without confusing proxy behavior.
- [ ] Time-to-first-success/useful-finding measured for external design partners.
- [ ] Accessibility checks for launch-critical UI are green.

## F. Security operations

- [ ] Vulnerability disclosure/security contact is live.
- [ ] Secret-scanning/security CI is active.
- [ ] Incident severity/ownership/escalation process exists.
- [ ] Security-sensitive logs avoid secrets/tokens/private source.
- [ ] Admin/operator access is minimized and auditable as appropriate.
- [ ] Dependency/security update process is operating.
- [ ] Latest isolation/restore evidence is recent enough for launch decision.

## G. Observability and support

- [ ] Health/readiness checks distinguish process health from dependency readiness.
- [ ] Webhook/job/reconciliation/dispatch/result metrics exist.
- [ ] Customer-visible failures can be correlated to run IDs without exposing secrets.
- [ ] Alerts have an owner and runbook.
- [ ] Status/incident communication path exists.
- [ ] Support channel and expected response model are documented.
- [ ] Rollback/disable procedure exists for GitHub App/workflow/control-plane changes.

## H. Legal/privacy/commercial readiness

As applicable to the launch scope:

- [ ] Privacy policy reviewed/published.
- [ ] Terms of service reviewed/published.
- [ ] Data/subprocessor disclosures reviewed/published.
- [ ] Domain ownership/control is appropriate for production.
- [ ] Trademark/name conflict review status is recorded.
- [ ] Billing terms, cancellation/refund behavior, and taxes are handled if charging.
- [ ] OSS/Cloud licensing position is documented.
- [ ] Customer data use/training policy is documented before AI/manufacturing-data features.

Obtain qualified professional advice for legal/tax/privacy obligations; this checklist is not legal advice.

## I. Documentation and public claims

- [ ] README/docs match the deployed release.
- [ ] GitHub App permission docs match production manifest.
- [ ] Data flow/execution boundary docs match production.
- [ ] Support matrix matches tested versions.
- [ ] No planned feature is described as generally available.
- [ ] Compliance/security language is scoped and evidence-based.
- [ ] Customer logo/case-study usage has permission.

## J. Design-partner evidence

Before broad self-serve launch, strongly prefer:

- [ ] 2–5 real external teams onboarded or an explicitly documented alternative evidence base.
- [ ] representative private repository tested.
- [ ] at least one real release decision influenced.
- [ ] onboarding friction documented and highest blockers addressed.
- [ ] top ignored/noisy findings reviewed.
- [ ] willingness-to-pay/continued-use signal recorded.

## Mandatory GA no-go conditions

GA is **NO-GO** if any of these is true:

- unresolved credible cross-tenant path;
- forged/misattributed result can be accepted;
- unexplained excessive GitHub App permission;
- accepted work can disappear without a recovery mechanism;
- backup/restore objective is unproven;
- product copy materially misrepresents data/execution/security behavior;
- current P0 repository/release-health blocker is open;
- issue #191 reliability + GitHub Cloud GA exit conditions are incomplete.

## Final decision

```text
Promotion:
Environment:
Commit/deployment:
Date:
Decision: GO / NO-GO
Evidence links:
Accepted risks:
Rollback trigger:
Approvers/review roles:
```
