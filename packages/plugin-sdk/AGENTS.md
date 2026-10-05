# Plugin SDK Instructions

These instructions apply to `packages/plugin-sdk/**` and supplement the repository root instructions.

The Plugin SDK is a public extension contract. Plugins execute inside the BoardReadyOps Node.js process in standard/trusted mode.

## Trust statement

Plugins are not a sandbox.

- Treat configured plugins as trusted project code.
- Permission declarations describe and gate expected capabilities, but they are not malicious-code isolation.
- Safe mode loading zero plugins is the enforced boundary for untrusted execution contexts.
- Do not describe `node:vm`, the Node permission model, or SDK permission metadata as a security boundary.

Read `docs/architecture/adr/0009-plugin-sandboxing.md` before changing this contract.

## Public API discipline

- Keep exported plugin types and helpers stable or make compatibility breaks explicit.
- Additive fields should preserve existing plugins when possible.
- Permission names are security-relevant public vocabulary; adding one requires host-loader support, documentation, and tests.
- Do not promise support for untrusted third-party plugins without a separately accepted isolation design.

## Verification

Run SDK typecheck/consumer tests plus root plugin-loader tests when the contract changes.
