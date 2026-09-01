# ADR 0009: Plugin Trust Boundary and Execution Model

## Status

Accepted. Revises the original proposal below, which is rejected — see "Decision".

## Context

BoardReadyOps has a plugin architecture that allows external teams to define custom rules, report formats, and adapters.
The plugin loader (`src/core/plugin-loader.ts`) validates that loaded plugins request permissions (`PluginPermission = "fs:read" | "fs:write" | "network" | "process" | "kicad-cli"`) and checks them against the user's `boardreadyops.yml` configuration (`pluginPermissions`).

Node.js loads a plugin's entry point via `import()`. Module evaluation runs a module's top-level code as a side effect of importing it, so a plugin's declared permissions cannot be known before that top-level code has already run once in the host process — the plugin's exported object (which carries `permissions`, per `pluginSchema` in `plugin-loader.ts`) does not exist until the module has finished evaluating.

`loadPlugins` also reads a plugin's `package.json` (`boardreadyops.permissions`, via `readStaticPluginManifest`) and rejects it before `import()` runs if that static declaration already exceeds what the user's config allows. This closes the gap for plugins that honestly declare their permissions in `package.json` ahead of time. It does not close it in general: a plugin that omits the static declaration, or declares permissions only on its exported object, still has its top-level module code executed unconditionally before any permission decision is possible — because that declaration is the thing being read.

An earlier draft of this ADR proposed compiling and running plugin code inside a `node:vm` context with a stripped-down `globalThis`, to execute plugin code without granting it real capabilities up front. That design is rejected; see "Rejected design" below.

## Decision

BoardReadyOps does not claim to sandbox third-party plugin code against a malicious author. Node.js's own documentation is explicit that neither `node:vm` contexts nor the `--permission` CLI flag (stable since Node 22.13.0 / 23.5.0) provide security guarantees in the presence of malicious code:

> "The permission model implements a 'seat belt' approach, which prevents trusted code from unintentionally changing files or using resources that access has not explicitly been granted to. It does not provide security guarantees in the presence of malicious code, as malicious code can bypass the permission model and execute arbitrary code without restrictions." — Node.js Permission Model documentation (v22.x / v24.x)

`node:vm` contexts share the host process and heap and are reachable through documented context-escape techniques (prototype/constructor traversal among them); Node's own docs do not present `vm` as an untrusted-code sandbox either, and the permission model explicitly disclaims one. Shipping either mechanism as "plugin sandboxing" would tell users their plugins are isolated from malicious code when they are not.

This matches what `docs/plugin-sdk.md` and `docs/security/threat-model.md` already say and have said independently of this ADR: plugins are documented as trusted workspace code, and "not a sandbox." This ADR was out of sync with that reality; it is now corrected to match it, rather than the other way around.

The accepted trust model:

1. **Safe mode is the real boundary.** When `executionPolicy: "safe"` (untrusted contexts: fork PRs, draft PRs, PRs from outside collaborators — see `apps/web/lib/runner-mode.js` and `src/core/pipeline.ts`), BoardReadyOps loads **zero plugins**. No plugin code, trusted or not, executes. Enforced today at `src/core/pipeline.ts` (`discoverPhase`): `executionPolicy === "safe"` short-circuits to an empty plugin load before `loadPlugins` is ever called.
2. **Standard mode treats a configured plugin like any other project dependency.** Loading a plugin in standard/trusted mode requires the user to have explicitly listed it in `boardreadyops.yml` (`plugins: [...]`) or placed it under `local-rules/`. That is the same trust act as adding any npm dependency: the user chose to run this code. BoardReadyOps cannot retroactively make that code safe to run without real OS/container isolation.
3. **The static `package.json` permission pre-check is defense-in-depth, not a security boundary.** `readStaticPluginManifest()` catches configuration mistakes and honestly-declared over-broad permission requests before any plugin code runs. It cannot stop a plugin that omits the declaration or lies in it — an author willing to write malicious code is equally willing to omit or misstate this field, and the loader has no way to verify it without executing the code it claims to describe.
4. **Permission declarations gate rule registration and execution, not module import.** Once a plugin's module has been imported, `evaluatePluginPermissions` decides whether its declared rules are registered and allowed to run. It cannot undo any side effect the module already caused at import time.

## Rejected design: `node:vm` capability sandbox

Preserved for record; do not implement as written.

The proposal was a **Capability-Based VM Sandbox** using `node:vm`: load the plugin entry point as text, compile and run it in `vm.createContext()` with a clean `globalThis` (no `process`, `require`, `fs`, `net`, `http`), inject capability-scoped proxies (a workspace-confined `fs`, a `kicad-cli` runner, a domain-allowlisted `fetch`) based on granted permissions, and freeze prototype chains to blunt constructor-traversal escapes.

Rejected because:

- Node's own documentation does not describe `vm` as a security mechanism for untrusted code; it is a context-separation utility, not an isolation boundary.
- Frozen-prototype defenses against context escapes are a known-incomplete mitigation, not a closed threat class — new escape techniques are found against this class of defense in JavaScript engines generally.
- The requirement that ruled out `isolated-vm` (real V8 isolates, but native/`node-gyp`) applies for the same reason to any approach that would provide an actual boundary: real isolation is inherently heavier than "pure JS/TS."
- Shipping this and calling it a sandbox would be a false security claim to users, which BoardReadyOps's product-truth rules explicitly forbid making about any surface.

## Consequences

- BoardReadyOps does not support a third-party plugin marketplace of untrusted, unreviewed plugins. Loading a plugin in standard mode is a user trust decision; safe mode's default-deny is the only enforced boundary.
- Product surfaces (docs, plugin SDK reference, marketing) must classify plugin "sandboxing" as `unsupported`, not `available` or `planned`, until real OS/container-level isolation (a separate unprivileged process or container with kernel-enforced restrictions — e.g. gVisor, Firecracker, seccomp-bpf) is built and verified. That is a materially larger investment than anything achievable in pure JS/TS and is out of scope until real demand justifies it.
- `docs/security/threat-model.md`'s hardening follow-up "Implement plugin runtime sandboxing or explicitly document plugins as trusted code execution with stronger warnings" is resolved by this ADR: the second option is the decision. Runtime sandboxing remains a possible future major-version change if the extension ecosystem outgrows trusted project-local plugins, and would need its own ADR proposing real (OS/container) isolation.
- The static manifest pre-check (`readStaticPluginManifest`) stays as a low-cost, useful courtesy check; its error messages and docs must not imply it blocks malicious plugins, only honestly-declared over-broad ones.
