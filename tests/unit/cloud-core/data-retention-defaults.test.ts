import { DATA_RETENTION_DEFAULTS } from "@boardreadyops/cloud-core/data-retention-defaults";
import { describe, expect, it } from "vitest";

describe("data retention defaults", () => {
  it("describes the current non-destructive lifecycle contract by data class", () => {
    expect(DATA_RETENTION_DEFAULTS).toEqual({
      webhookInboxDays: 30,
      terminalEphemeralRecordDays: 30,
      completedControlPlaneHistoryDays: 90,
      managedArtifactDaysByPlan: { free: 30, team: 365, business: null, enterprise: null },
      logicalRunMetadataDays: null,
      findingAndResultDays: null,
      auditEventDays: null,
    });
  });
});
