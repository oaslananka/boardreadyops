import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const { searchParams } = vi.hoisted(() => ({
  searchParams: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useSearchParams: searchParams,
}));

import { SignInFailureNotice, SignInFeedbackFromUrl } from "../../../apps/web/components/sign-in-feedback.js";

describe("GitHub OAuth callback feedback", () => {
  it.each([
    ["expired", "Your GitHub sign-in expired"],
    ["denied", "GitHub sign-in could not be completed"],
    ["unavailable", "GitHub sign-in is temporarily unavailable"],
  ])("explains a %s callback failure and offers a retry", (reason, title) => {
    const markup = renderToStaticMarkup(createElement(SignInFailureNotice, { reason }));
    expect(markup).toContain('role="alert"');
    expect(markup).toContain('aria-label="GitHub sign-in status"');
    expect(markup).toContain(title);
    expect(markup).toContain('href="/api/auth/github/login"');
    expect(markup).toContain("Try GitHub sign-in again");
  });

  it("does not reflect arbitrary query parameters or show a warning on a normal visit", () => {
    expect(renderToStaticMarkup(createElement(SignInFailureNotice, { reason: null }))).toBe("");
    expect(renderToStaticMarkup(createElement(SignInFailureNotice, { reason: "<script>alert(1)</script>" }))).toBe("");
  });

  it("reads only the expected GitHub callback query parameter", () => {
    searchParams.mockReturnValue(new URLSearchParams("sign_in=expired&return_to=https%3A%2F%2Fevil.example"));
    const markup = renderToStaticMarkup(createElement(SignInFeedbackFromUrl));
    expect(markup).toContain("Your GitHub sign-in expired");
    expect(markup).not.toContain("evil.example");
  });
});
