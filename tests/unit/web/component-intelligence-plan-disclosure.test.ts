import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const installationsMock = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "test-engineer", installationIds: [17] } })),
}));
vi.mock("../../../apps/web/lib/viewer-installations.js", () => ({
  viewerInstallations: installationsMock,
}));
vi.mock("../../../apps/web/lib/settings-form-token.js", () => ({
  issueSettingsFormToken: vi.fn(() => "test-form-token"),
}));
vi.mock("@boardreadyops/cloud-core/credential-encryption", () => ({
  configuredCredentialCipher: vi.fn(() => ({})),
}));

const { default: ComponentIntelligencePage } = await import(
  "../../../apps/web/app/settings/component-intelligence/page.js"
);

async function render(planTier: string): Promise<string> {
  installationsMock.mockResolvedValue([
    {
      id: "install-17",
      accountLogin: "test-engineer",
      planTier,
      hasComponentCredential: false,
    },
  ]);
  return renderToStaticMarkup(await ComponentIntelligencePage({ searchParams: Promise.resolve({}) }));
}

describe("Component intelligence plan transparency", () => {
  it("does not solicit a free-plan Nexar secret before an explicit advanced disclosure", async () => {
    const html = await render("free");
    expect(html).toContain("Supply watch is not on this plan");
    expect(html).toContain("this plan does not run supply lookups");
    expect(html).toContain('href="/settings/billing"');
    expect(html).toContain("<details");
    expect(html).toContain("Optional: prepare provider credentials in advance");
    expect(html).not.toContain("<details open");
    const disclosure = html.slice(html.indexOf("<details"), html.indexOf("</details>") + "</details>".length);
    expect(disclosure).toContain('name="client_secret"');
    expect(disclosure).toContain('type="password"');
    expect(disclosure).toContain('name="action"');
  });

  it("continues to expose credential management for plans with supply watch", async () => {
    const html = await render("team");
    expect(html).toContain("Included");
    expect(html).not.toContain("Optional: prepare provider credentials in advance");
    expect(html).not.toContain("<details");
    expect(html).toContain('name="client_secret"');
    expect(html).toContain('name="action"');
  });
});
