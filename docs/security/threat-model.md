# Threat Model

BoardReadyOps reads local KiCad, BOM, pinmap, firmware-contract, configuration,
and manufacturing-output files. It writes reports, generated artifacts, release
evidence bundles, and manufacturer handoff packages. It runs locally as a CLI and
inside GitHub Actions.

## Assets

- PCB and schematic design data.
- BOM and supplier/manufacturer part data.
- Release evidence bundles, checksums, and signatures.
- GitHub workflow credentials and package-publish credentials.
- User configuration, waivers, suppressions, and policy decisions.
- Plugin code and plugin configuration.

## Trust boundaries

| Boundary | Trust level | Notes |
| --- | --- | --- |
| Repository files | Untrusted input | A PR can change KiCad, BOM, config, plugin, and workflow files. |
| `kicad-cli` | External executable | Invoked with bounded process output and timeouts. |
| GitHub Actions credential | Sensitive credential | Workflows should use minimum permissions and avoid untrusted writes on fork PRs. |
| Release signing key | Highly sensitive | Should never be committed; used only through explicit release signing flow. |
| Plugin packages/local rules | Trusted-code execution today | Permission declarations exist, but runtime sandboxing is not yet enforced. |
| Network notifiers | External service boundary | Delivery credentials come from environment variables or GitHub configuration. |

## Threats

| Threat | Impact | Current control | Gap |
| --- | --- | --- | --- |
| Malicious workflow change | Repository or release compromise | Pinned actions, minimum permissions, review expectations, security workflow. | Enforce required status checks and human review. |
| Sensitive data leakage in logs/reports | Credential exposure | Logger redaction, issue templates warning about redaction, gitleaks. | Verify secret scanning/push protection in settings. |
| Malicious plugin code | Arbitrary host process access | Plugin permission declaration and config approval. | v1 trusted-code model documented; runtime sandbox optional future hardening. |
| Tampered release asset | Unsafe install or CI use | Checksums, SBOM, provenance/attestation docs. | Strengthen reproducible-build verification. |
| Unsafe manufacturer handoff | Bad board order or assembly failure | Rule checks, vendor profiles, readiness scoring, evidence bundles. | Vendor profile drift review process. |
| Path traversal via inputs | File overwrite/read outside workspace | Action input path confinement and utility path helpers. | Continue fuzz/property tests for path normalization. |
| Dependency compromise | Build or runtime compromise | Lockfile, audits, OSV, dependency review, pinned actions. | Review major updates manually. |

## Assumptions

- Users do not run untrusted plugins or local rules without reviewing them.
- Maintainers protect release credentials and signing keys outside the repository.
- GitHub repository settings enforce branch protection and review rules.
- CI results are reviewed before release or package publication.

## Required hardening follow-ups

1. Implement plugin runtime sandboxing or explicitly document plugins as trusted
   code execution with stronger warnings.
2. Require status checks in branch protection/rulesets.
3. Verify private vulnerability reporting, sensitive-data scanning, and push protection.
4. Add vendor profile drift review evidence.
5. Document release reproducibility expectations for binary assets.
