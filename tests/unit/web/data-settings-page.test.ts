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
      "Control-plane lifecycle defaults",
      "Webhook terminal metadata",
      "One-time control-plane records",
      "Completed delivery history",
      "Runs, findings & audit events",
      "Managed artifact retention",
      "Component source cache",
      "Repository retention overrides",
      "GitHub App uninstall lifecycle",
      "Access stops immediately.",
      "Portability is queued.",
      "Destructive erasure waits 30 days.",
      "Reinstall preserves portability.",
      "Delete-later boundary",
      "installation",
    ]) {
      expect(page).toContain(text);
    }
    expect(page).toContain("loadDataSettingsAdmin");
    expect(page).toContain("Business/Pilot/Enterprise");
    expect(page).toContain("retained for up to {sourceRetentionHours}");
    expect(page).not.toContain("source data remains capped at 24 hours");
    expect(page).toContain("resolveControlPlaneRetentionConfiguration");
    expect(page).toContain("controlPlaneRetention.webhookInboxDays");
    expect(page).toContain("controlPlaneRetention.ephemeralRecordsDays");
    expect(page).toContain("controlPlaneRetention.controlPlaneHistoryDays");
    expect(page).toContain("No automatic age-based purge");
    expect(page).toContain("RetentionPolicyForm");
    expect(page).toContain("RepositoryRetentionPolicyForm");
    expect(page).toContain("saveRepositoryRetentionPolicyAction");
    const forms = await readFile("apps/web/components/settings/data-admin-forms.tsx", "utf8");
    expect(forms).toContain("Save override");
    expect(forms).toContain('value="inherit"');
    expect(forms).toContain('value="indefinite"');
    expect(forms).toContain('value="custom"');
    expect(page).toContain("LegalHoldCreateForm");
    expect(page).toContain("LegalHoldReleaseButton");
    expect(page).toContain("installationId={admin.selected.id}");
    expect(page).toContain("defaultScopeLabel={admin.selected.accountLogin}");
    expect(page).toContain('id="uninstall-lifecycle"');
    expect(page).toContain('href="#data-export"');
    expect(page).toContain('href="#legal-holds"');
    expect(page).toContain('href="#erasure-request"');
    expect(page).toContain("Legal holds do not block export intake");
    expect(page).toContain("deadline 30 days after BoardReadyOps");
    expect(page).toContain("cancels a still-active uninstall erasure request");
    expect(page).toContain("Complete relational erasure");
    expect(page).toContain("non-local managed-object deletion");
  });

  it("does not promise completed exports or destructive erasure from intake alone", async () => {
    const page = await readFile("apps/web/app/settings/data/page.tsx", "utf8");
    const forms = (await readFile("apps/web/components/settings/data-lifecycle-forms.tsx", "utf8")).replace(
      /\s+/gu,
      " ",
    );
    const receipt = (await readFile("apps/web/components/settings/export-request-receipt.tsx", "utf8")).replace(
      /\s+/gu,
      " ",
    );
    const service = await readFile("apps/web/lib/data-settings-admin.ts", "utf8");

    expect(page).toContain("An export request does not create a downloadable pack automatically.");
    expect(page).toContain("Submitting an erasure request does not delete records.");
    expect(forms).toContain("ExportRequestReceipt");
    expect(receipt).toContain("An export request does not create a customer");
    expect(receipt).toContain("archive automatically.");
    expect(receipt).toContain('<AlertRoot variant="info">');
    expect(receipt).toContain("not your full customer data archive");
    expect(receipt).toContain("Download metadata preview");
    expect(receipt).toContain("Revoke metadata preview");
    expect(forms).not.toContain("href={`/api/v1/data-exports/");
    expect(forms).toContain("A non-preview request is only recorded for an authorized operator workflow.");
    expect(forms).toContain("Preview records the requested scope; it does not list matching records.");
    expect(service).toContain("Export request recorded; creating a downloadable pack requires operator processing.");
    expect(service).toContain("Erasure request recorded; no records have been deleted.");

    expect(page).not.toContain("Removes records for a scope.");
    expect(forms).not.toContain("Download it from");
    expect(forms).not.toContain("Uncheck the preview box to run it for real.");
    expect(forms).not.toContain("Processing happens asynchronously and cannot be undone.");
    expect(service).not.toContain("Erasure requested. It is processed asynchronously and cannot be undone.");
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
    expect(forms).toContain("requests already blocked by this hold remain blocked");
    expect(forms).toContain("release does not resume deletion");
    expect(forms).toContain("authorized, audited operator requeue is required and is not yet supported");
    expect(forms).not.toContain("will stop blocking retention cleanup and matching erasure requests");
    expect(forms).toContain("Repository and user holds need an exact id");
  });
});
