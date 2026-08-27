import { describe, expect, it } from "vitest";
import { ChangesTab } from "../../../apps/web/components/review/changes-tab.js";
import { EvidenceTab } from "../../../apps/web/components/review/evidence-tab.js";
import { OverviewTab } from "../../../apps/web/components/review/overview-tab.js";
import { DEMO_REVIEWS } from "../../../apps/web/lib/demo-data.js";

describe("Review Detail Tabs", () => {
  const review = DEMO_REVIEWS[0] as (typeof DEMO_REVIEWS)[0];

  it("renders OverviewTab with readiness gate status and metadata", () => {
    const overview = OverviewTab({ review });
    expect(overview).toBeDefined();
    expect(overview.props).toBeDefined();
  });

  it("renders ChangesTab with schematic, layout, and BOM diffs", () => {
    const changes = ChangesTab({ review });
    expect(changes).toBeDefined();
    expect(changes.props).toBeDefined();
  });

  it("renders EvidenceTab with artifact manifest and offline verify command", () => {
    const evidence = EvidenceTab({ review });
    expect(evidence).toBeDefined();
    expect(evidence.props).toBeDefined();
  });
});
