import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { context } = vi.hoisted(() => ({
  context: { session: null as { login: string } | null, marketing: false },
}));

vi.mock("../../../apps/web/lib/viewer-authorization.js", () => ({
  viewerAuthorization: async () => ({ session: context.session }),
}));
vi.mock("../../../apps/web/lib/marketing-surface.js", () => ({
  isMarketingSurface: () => context.marketing,
  applicationHref: (href: string) => href,
}));

import { LandingHeroActions } from "../../../apps/web/components/landing-actions.js";

beforeEach(() => {
  context.session = null;
  context.marketing = false;
});

describe("Returning-customer landing CTAs (#446)", () => {
  it("takes an authenticated reader straight to the dashboard from the bottom CTA", async () => {
    context.session = { login: "board-owner" };
    const markup = renderToStaticMarkup(await LandingHeroActions({ placement: "next-release" }));
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain("Open dashboard");
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain("Review setup first");
    expect(markup).not.toContain("Install on GitHub");
    expect(markup).not.toContain("Add another repository");
  });

  it("preserves the existing installation and setup path for a signed-out visitor", async () => {
    const markup = renderToStaticMarkup(await LandingHeroActions({ placement: "next-release" }));
    expect(markup).toContain('href="https://github.com/apps/boardreadyops/installations/new"');
    expect(markup).toContain("Install on GitHub");
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain("Review setup first");
    expect(markup).not.toContain("Open dashboard");
  });

  it("keeps the existing hero behavior for returning users", async () => {
    context.session = { login: "board-owner" };
    const markup = renderToStaticMarkup(await LandingHeroActions());
    expect(markup).toContain('href="/dashboard"');
    expect(markup).toContain("Open dashboard");
    expect(markup).toContain("Add another repository");
  });

  it("keeps independent marketing sites on the public install and setup path", async () => {
    context.session = { login: "board-owner" };
    context.marketing = true;
    const markup = renderToStaticMarkup(await LandingHeroActions({ placement: "next-release" }));
    expect(markup).toContain("Install on GitHub");
    expect(markup).toContain("Review setup first");
    expect(markup).not.toContain("Open dashboard");
  });
});
