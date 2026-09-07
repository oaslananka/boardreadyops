// Entry point bundled by generate-rule-docs.mjs so a plain-Node script can read the rule
// registry, which lives in TypeScript. Nothing else imports this.
export { listRules } from "../src/core/rule-registry.js";
export { registerBuiltInRules } from "../src/rules/_index.js";
