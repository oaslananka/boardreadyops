import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Data & Retention settings administration", () => {
  it("renders tenant-scoped retention and legal-hold administration alongside export/erasure", async () => {
    const page = await readFile("apps/web/app/settings/data/page.tsx", "utf8");
    for (const text of [
      "Retention policy",
      "Legal holds",
      "Create legal hold",
      "Export your data",
      "Erasure request",
      "installation",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("loadDataSettingsAdmin");
    expect(page).toContain("RetentionPolicyForm");
    expect(page).toContain("LegalHoldCreateForm");
    expect(page).toContain("LegalHoldReleaseButton");
    expect(page).toContain("installationId={admin.selected.id}");
    expect(page).toContain("defaultScopeLabel={admin.selected.accountLogin}");
  });

  it("wires server actions for save/create/release and revalidates the page", async () => {
    const actions = await readFile("apps/web/app/settings/data/actions.ts", "utf8");
    expect(actions).toContain("saveRetentionPolicyAction");
    expect(actions).toContain("createLegalHoldAction");
    expect(actions).toContain("releaseLegalHoldAction");
    expect(actions).toContain("saveRetentionPolicyForViewer");
    expect(actions).toContain("createLegalHoldForViewer");
    expect(actions).toContain("releaseLegalHoldForViewer");
    expect(actions).toContain("requestExportForViewer");
    expect(actions).toContain("requestErasureForViewer");
    expect(actions.match(/revalidatePath\("\/settings\/data"\)/gu)?.length).toBeGreaterThanOrEqual(3);
  });

  it("keeps retention controls bounded and hold release behind an explicit confirmation", async () => {
    const forms = await readFile("apps/web/components/settings/data-admin-forms.tsx", "utf8");
    expect(forms).toContain("min={1}");
    expect(forms).toContain("max={3650}");
    expect(forms).toContain('name="installationId"');
    expect(forms).toContain("Release legal hold?");
    expect(forms).toContain("Repository and user holds need an exact id");
  });
});
