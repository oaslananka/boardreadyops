import { hasWorkspaceEntitlement, type WorkspaceEntitlement } from "@boardreadyops/cloud-core";

export interface EntitlementCheckResult {
  allowed: boolean;
  status?: number;
  error?: string;
  requiredTier?: string;
}

export function assertWorkspaceEntitlement(
  tier: string | null | undefined,
  entitlement: WorkspaceEntitlement,
): EntitlementCheckResult {
  if (hasWorkspaceEntitlement(tier, entitlement)) {
    return { allowed: true };
  }

  const requiredPlan =
    entitlement === "canConfigureCustomRules" || entitlement === "canExportTraceableHandoff"
      ? "Business ($149/mo)"
      : "Team ($29/mo)";

  return {
    allowed: false,
    status: 403,
    requiredTier: requiredPlan,
    error: `This feature requires a ${requiredPlan} plan subscription. Upgrade your workspace to unlock ${entitlement}.`,
  };
}
