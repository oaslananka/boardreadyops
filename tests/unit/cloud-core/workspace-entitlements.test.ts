import { describe, expect, it } from "vitest";
import { assertWorkspaceEntitlement } from "../../../apps/web/lib/workspace-entitlements.js";
import { hasWorkspaceEntitlement, type WorkspaceEntitlement } from "../../../packages/cloud-core/src/entitlements.js";

describe("Workspace Entitlements", () => {
  const allEntitlements: WorkspaceEntitlement[] = [
    "canCreateDeliveryLink",
    "canAccessRevisionDiff",
    "canConfigureCustomRules",
    "canExportTraceableHandoff",
  ];

  it("denies advanced feature entitlements to community / free tier", () => {
    for (const ent of allEntitlements) {
      expect(hasWorkspaceEntitlement("community", ent)).toBe(false);
      expect(hasWorkspaceEntitlement("free", ent)).toBe(false);
    }
  });

  it("grants delivery links and revision diffing to team tier, but gates business features", () => {
    expect(hasWorkspaceEntitlement("team", "canCreateDeliveryLink")).toBe(true);
    expect(hasWorkspaceEntitlement("team", "canAccessRevisionDiff")).toBe(true);
    expect(hasWorkspaceEntitlement("team", "canConfigureCustomRules")).toBe(false);
    expect(hasWorkspaceEntitlement("team", "canExportTraceableHandoff")).toBe(false);
  });

  it("grants all entitlements to business, pilot, and enterprise tiers", () => {
    for (const tier of ["business", "pilot", "enterprise"]) {
      for (const ent of allEntitlements) {
        expect(hasWorkspaceEntitlement(tier, ent)).toBe(true);
      }
    }
  });

  it("assertWorkspaceEntitlement returns 403 with descriptive upgrade advice when denied", () => {
    const deniedResult = assertWorkspaceEntitlement("community", "canCreateDeliveryLink");
    expect(deniedResult.allowed).toBe(false);
    expect(deniedResult.status).toBe(403);
    expect(deniedResult.error).toContain("Team ($29/mo)");

    const allowedResult = assertWorkspaceEntitlement("team", "canCreateDeliveryLink");
    expect(allowedResult.allowed).toBe(true);
    expect(allowedResult.error).toBeUndefined();
  });
});
