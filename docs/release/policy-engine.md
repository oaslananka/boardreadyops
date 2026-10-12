# Policy Engine

The policy engine adds a configurable release policy layer on top of the pipeline result. A policy is a set of blocking rules evaluated against the findings and the [readiness score](readiness-scoring.md); when enforced, a failing policy blocks the release.

## Configuration

Add a `policy` section to `boardreadyops.yml`. It is validated against the configuration schema.

```yaml
version: 1
vendor:
  profile: jlcpcb
policy:
  enforce: true # when true, a failing policy makes `boardreadyops policy` exit 1
  rules:
    - id: no-blocking-findings
      type: max-severity
      severity: high # fail if any finding is at or above this severity
    - id: minimum-readiness
      type: min-readiness-score
      score: 80
    - id: required-outputs
      type: require-required-outputs
    - id: ready-or-at-risk
      type: require-readiness-status
      status: [ready, at-risk]
    - id: finding-budget
      type: max-findings
      max: 25
    - id: no-eol
      type: forbid-rules
      rules: [bom.eol-component]
```

### Rule types

| Type | Fails when | Fields |
| --- | --- | --- |
| `max-severity` | any finding is at or above `severity` | `severity` |
| `max-findings` | the total finding count exceeds `max` | `max` |
| `min-readiness-score` | the readiness score is below `score` | `score` |
| `require-readiness-status` | the readiness status is not in `status` | `status` |
| `require-required-outputs` | any required vendor output is missing | — |
| `forbid-rules` | any listed rule id produced a finding | `rules` |
| `forbid-expired-waivers` | any [waiver](waivers.md) has expired | — |
| `forbid-stale-waivers` | any fingerprint-scoped waiver no longer matches a finding | — |

## Evaluating a policy

```bash
boardreadyops policy .            # evaluate; exit 1 if an enforced policy fails
boardreadyops policy . --simulate # evaluate and print the result without affecting the exit code
boardreadyops policy . --format json
```

Simulation mode is the recommended way to preview a policy change in CI before turning on enforcement: it prints the full per-rule explanation and always exits `0`.

The policy result is also attached to the run result, so it appears in the JSON report under `policy` and as a badge in the [HTML release dashboard](../reports/html.md) decision banner.

## Cloud policy inheritance and provenance

The hosted review workflow can layer governance policy on top of repository results. The organization policy is the baseline; a repository policy may override the fields it explicitly configures. The resolver applies later layers only when they contribute a value, so an empty repository policy does not hide the organization baseline.

Current hosted review enforcement resolves organization and repository layers. The policy contract also reserves team and exception layers for future governance flows.

Inheritance is field-aware:

- non-empty `requiredChecklist` and `requiredRoles` values replace the inherited value;
- an explicitly configured `severityGate` replaces the inherited threshold;
- `requireEvidencePack` and `requireExternalReview` are monotonic requirements: a repository may turn an inherited requirement on, but cannot turn an organization requirement off by setting `false`; and
- every effective field records the policy id, policy name, and layer that supplied it.

The review Overview shows this field-level provenance under **Effective Policy & Inheritance**. This makes repository-specific exceptions visible without pretending the whole effective policy came from one layer. The same resolver feeds review-readiness enforcement, so the displayed provenance and the approval gate use the same effective-policy calculation.

This provenance describes the policy that is effective **now** for the review.

Policy mutations are separately recorded in the tenant-scoped, append-only `review_policy_audit_events` history. Create, update, and delete mutations write their audit event in the same PostgreSQL statement as the policy change, including the authenticated GitHub actor plus before/after policy snapshots where applicable. The history remains available after a policy is deleted and can be read for an owned policy through `GET /api/v1/policies/:id/audit`.

Historical **per-run effective-policy snapshots** are still separate work. The mutation audit proves how governance configuration changed over time; it does not by itself prove which effective policy a past release run evaluated. Do not treat the current-policy view as immutable historical run evidence until run-scoped policy snapshots are persisted.


## Opt-in source-bound manufacturing export policy (#771)

After reviewing the **target repository's** reviewed source, protected workflow and
signer/run identity independently, a project may opt in to an **enforced** source
provenance prerequisite (this does not change the product's default policy):

```yaml
# boardreadyops.yml (reviewed separately from generated fabrication files)
version: 1
policy:
  enforce: true
  rules:
    - id: signed-fabrication-from-reviewed-source
      type: require-source-bound-export
```

Use the `boardreadyops policy` command as an explicit CI gate on an exact
approved target checkout containing the downloaded original fabrication
output tree. Supply the expectations obtained from the **independently
authorized GitHub run record**, not values copied from an upload or the
unsigned manifest. You can pass `--bundle <file>` for separately downloaded
offline Sigstore verification.

```bash
boardreadyops policy . --format json \
  --manifest build/boardreadyops-attested/manifest.json \
  --repository OWNER/REPO --repository-id 123456 \
  --reviewed-source-sha 0123456789abcdef0123456789abcdef01234567 \
  --source-ref refs/heads/main \
  --workflow .github/workflows/boardreadyops-manufacturing-attested.yml \
  --event workflow_dispatch --run-id 123456789 --run-attempt 1
```

The policy output contains both the ordinary findings policy decision and a
**source-bound trust classification**:

- `source-bound-verified`: GitHub/Sigstore signature successfully checked
  against an authorized numeric repository ID, source revision/ref, signer
  workflow, run attempt, OIDC issuer, GitHub-hosted environment, and the
  complete manifest plus *actual* Gerber/Excellon subject hashes. The
  verifiable source SHA, run URL and subject count are present in JSON/text.
- `byte-consistent-only`: the self-reported manifest matches actual local
  bytes, **without** an accepted independent signer/run identity. This is
  useful inspection evidence, but **fails** the strong-source rule.
- `unverified`: evidence is missing, inaccessible, changed or inconsistent.
  This also **fails** the strong-source rule.

With `policy.enforce: true`, a failed rule causes `boardreadyops policy`
to exit **1**, including missing/invalid/unsupported signed proof. Without
`enforce`, it remains advisory. `--simulate` retains its preexisting
nonblocking preview semantics and must never serve as a release gate.

The special strong-source rule is **not inferred** from
`release.artifact-provenance`, an attestation URL or a `verified` manifest
flag: these are not cryptographic proof. The low-level `run` command with
this strict rule and no signed proof also reports a failed policy. Existing
`release pack`, production workflows, dashboard status, customer-level
tenancy acceptance, default releases and GA controls are **not automatically
enabled** by this CLI option; the approved CI workflow must call the policy
gate explicitly before any authorized handoff or release step. Two genuinely
independent private GitHub App installations and the end-to-end #154
acceptance are still required before customer-facing GA state is enabled.
