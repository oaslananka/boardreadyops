# Website, Brand, and Domain Strategy

**Status:** domain/brand choices are proposed until registration and conflict review are complete.

## Domain recommendation

Preferred canonical commercial domain if available and cleared:

- `boardreadyops.com`

Useful defensive/developer candidates if available and economically reasonable:

- `boardreadyops.dev`;
- `boardreadyops.io`.

Do not treat DNS non-resolution as proof of registration availability. Confirm with a registrar before recording acquisition as fact.

## Domain topology

If `boardreadyops.com` becomes canonical:

```text
boardreadyops.com          marketing/product
app.boardreadyops.com      hosted application
/docs or docs.*            documentation
status.boardreadyops.com   service status
trust.boardreadyops.com    security/privacy/trust center
api.boardreadyops.com      only if a stable public API boundary warrants it
```

Avoid creating subdomains merely because they look enterprise-ready. Each should have an owner and purpose.

## Website/app repository structure

Current recommendation: do not split repositories by frontend/backend.

Potential monorepo shape:

```text
apps/
  site/     -> boardreadyops.com
  web/      -> app.boardreadyops.com
  container/
packages/
  contracts/
  cloud-core/
  db/
  plugin-sdk/
```

`apps/site` and `apps/web` should deploy independently even if they share a repository.

## Marketing site MVP

### Home

Answer in order:

1. What outcome does BoardReadyOps create?
2. How does it fit into GitHub/hardware release workflow?
3. What evidence does it produce?
4. Where does customer source execute?
5. How do I try it?

Candidate hero:

> **Know what changed. Know if it is safe to manufacture. Prove what shipped.**

Support with a real PASS/WARN/BLOCK example rather than generic illustrations.

### Product

- PR hardware change impact;
- manufacturing readiness;
- BOM/release intelligence;
- release evidence/passport;
- policies/waivers;
- Cloud history/monitoring.

Only show capabilities actually available or label planned/preview features clearly.

### Developers

- CLI;
- GitHub Action;
- schemas;
- configuration;
- plugin SDK;
- API/integration docs when stable.

### Security / Trust

Explain:

- GitHub App permissions;
- default execution boundary;
- OIDC result identity;
- artifact/data flow;
- retention/deletion;
- vulnerability disclosure;
- status/incident links.

### Pricing

Before pricing is validated, use early-access/design-partner language rather than inventing precise economics. Once charging, pricing page must match the billing model exactly.

## Application information architecture

Initial navigation should remain outcome-oriented:

- Overview;
- Repositories/Products;
- Runs/Changes;
- Releases;
- Evidence/Artifacts;
- Supply Chain (when active);
- Policies (when active);
- Organization;
- Settings.

Do not expose every database entity as a navigation item.

## First application screen

The dashboard should answer:

- What needs attention now?
- Which release/change is blocked?
- Why?
- What changed since the last known-good state?

Avoid vanity charts before actionable state.

## Brand trust hygiene

After domain acquisition:

- registrar MFA/passkeys;
- auto-renew;
- transfer/registrar lock;
- WHOIS privacy where appropriate;
- DNSSEC;
- controlled DNS provider;
- TLS/HSTS as appropriate;
- SPF/DKIM/DMARC before production email;
- `security@`, `support@`, and operational aliases;
- domain ownership recorded in organization credentials/process, not a single maintainer's unmanaged account.

## Trademark/name review

Before investing heavily in commercial identity:

- search relevant trademark/company/product databases;
- review confusingly similar names/classes/geographies;
- decide filing strategy with qualified counsel if warranted;
- align npm/GitHub/domain/marketplace naming.

Domain ownership is not trademark protection.

## Publication gate

Do not publish pricing, compliance/security claims, customer logos, availability commitments, or roadmap promises until their owners approve them and they match reality.
