import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  customerPlanLabel,
  customerStatusLabel,
} from "../../../apps/web/lib/customer-nomenclature.js";

describe("customer-facing nomenclature", () => {
  it("maps stored plan aliases to product-facing plan names", () => {
    expect(customerPlanLabel("community")).toBe("Free");
    expect(customerPlanLabel("free")).toBe("Free");
    expect(customerPlanLabel("team")).toBe("Team");
    expect(customerPlanLabel("business")).toBe("Business");
    expect(customerPlanLabel("pilot")).toBe("Pilot");
    expect(customerPlanLabel("enterprise")).toBe("Enterprise");
  });

  it("turns internal status tokens into readable labels", () => {
    expect(customerStatusLabel("not_configured")).toBe("Not Configured");
    expect(customerStatusLabel("in_progress")).toBe("In Progress");
    expect(customerStatusLabel("dead-letter")).toBe("Dead Letter");
    expect(customerStatusLabel(undefined)).toBe("Unknown");
  });

  it("keeps audited customer surfaces off raw plan/status rendering", async () => {
    const paths = [
      "apps/web/app/settings/component-intelligence/page.tsx",
      "apps/web/app/settings/data/page.tsx",
      "apps/web/app/settings/integrations/page.tsx",
      "apps/web/app/projects/page.tsx",
      "apps/web/components/repository-setup-interactive.tsx",
      "apps/web/components/review/checklist-approvals-tab.tsx",
      "apps/web/components/review/changes-tab.tsx",
      "apps/web/components/review/overview-tab.tsx",
      "apps/web/components/settings/data-lifecycle-forms.tsx",
      "apps/web/lib/repository-setup-state.ts",
    ] as const;

    const content = (await Promise.all(paths.map((path) => readFile(path, "utf8")))).join("\n");

    expect(content).not.toContain("{installation.planTier}</Definition>");
    expect(content).not.toMatch(/Plan:\\s*\\$\\{installation\\.planTier\\}/u);
    expect(content).not.toContain("{admin.selected.planTier}</dd>");
    expect(content).not.toContain("label={snapshot.deployment.status}");
    expect(content).not.toContain('replaceAll("_", " ")');
    expect(content).not.toContain("label={app.status}");
    expect(content).not.toContain("<AlertTitle>Export {issued.status}</AlertTitle>");
  });
});
