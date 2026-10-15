import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: vi.fn(async () => ({ session: { login: "octocat", installationIds: [1] } })),
}));
const loadEvidenceLedger = vi.hoisted(() => vi.fn());
vi.mock("../../../apps/web/lib/evidence-ledger.js", () => ({ loadEvidenceLedger }));
const { default: EvidencePage } = await import("../../../apps/web/app/evidence/page.js");

describe("Evidence empty-state next action", () => {
  it("takes a signed-in user to readiness runs rather than an empty review registry", async () => {
    loadEvidenceLedger.mockResolvedValue({ state: "ok", entries: [] });
    const markup = renderToStaticMarkup(await EvidencePage());
    expect(markup).toContain("No evidence recorded yet");
    expect(markup).toContain('href="/runs"');
    expect(markup).toContain("Inspect runs");
    expect(markup).not.toContain('href="/reviews">Go to Reviews');
  });

  it("keeps sign-in guidance separate from an empty ledger", async () => {
    loadEvidenceLedger.mockResolvedValue({ state: "signed-out" });
    const markup = renderToStaticMarkup(await EvidencePage());
    expect(markup).toContain("Sign in to see your evidence ledger");
    expect(markup).toContain('href="/api/auth/github/login"');
    expect(markup).not.toContain("No evidence recorded yet");
  });
});
