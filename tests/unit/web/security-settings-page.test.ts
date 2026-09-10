import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Security & Access settings page", () => {
  it("renders deployment security readiness instead of static environment instructions", async () => {
    const page = await readFile("apps/web/app/settings/security/page.tsx", "utf8");
    expect(page).toContain("securitySettingsReadiness");
    expect(page).toContain("Session protection");
    expect(page).toContain("GitHub App trust");
    expect(page).toContain("Enterprise SSO");
    expect(page).toContain("SCIM provisioning");
    expect(page).toContain("Operator-managed");
    expect(page).not.toContain("SAML_CERTIFICATE");
  });
});
