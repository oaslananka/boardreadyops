import { planLimits } from "./entitlements.js";

type RetentionDays = number | null;

export const DATA_RETENTION_DEFAULTS = {
  webhookInboxDays: 30,
  terminalEphemeralRecordDays: 30,
  completedControlPlaneHistoryDays: 90,
  managedArtifactDaysByPlan: {
    free: planLimits("free").evidenceRetentionDays,
    team: planLimits("team").evidenceRetentionDays,
    business: planLimits("business").evidenceRetentionDays,
    enterprise: null,
  },
  logicalRunMetadataDays: null,
  findingAndResultDays: null,
  auditEventDays: null,
} as const satisfies {
  webhookInboxDays: number;
  terminalEphemeralRecordDays: number;
  completedControlPlaneHistoryDays: number;
  managedArtifactDaysByPlan: Record<"free" | "team" | "business" | "enterprise", RetentionDays>;
  logicalRunMetadataDays: RetentionDays;
  findingAndResultDays: RetentionDays;
  auditEventDays: RetentionDays;
};
