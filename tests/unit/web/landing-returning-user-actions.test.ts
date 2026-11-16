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
  applicationHref: (href: string) => (context.marketing ? `https://app.boardreadyops.example${href}` : href),
}));

import { LandingHeroActions, LandingNavActions } from "../../../apps/web/components/landing-actions.js";

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

  it("lets returning but signed-out customers sign in without reinstalling the GitHub App", async () => {
    const markup = renderToStaticMarkup(await LandingHeroActions());
    expect(markup).toContain("Already connected? Sign in with GitHub");
    expect(markup).toContain('href="/api/auth/github/login"');
    expect(markup).toContain("Install on GitHub");
  });

  it("routes a public-only marketing visitor to the application instead of a 404 sign-in endpoint", async () => {
    context.marketing = true;
    const nav = renderToStaticMarkup(await LandingNavActions());
    const hero = renderToStaticMarkup(await LandingHeroActions());
    expect(nav).toContain('href="https://app.boardreadyops.example/api/auth/github/login"');
    expect(hero).toContain('href="https://app.boardreadyops.example/api/auth/github/login"');
    expect(hero).toContain('href="https://app.boardreadyops.example/setup"');
    expect(hero).toContain("Already connected? Sign in with GitHub");
    expect(nav).not.toContain('href="/api/auth/github/login"');
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
