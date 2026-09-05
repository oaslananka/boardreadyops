/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GuidedChecklist } from "../../../apps/web/components/guided-checklist.js";

describe("GuidedChecklist", () => {
  it("marks done steps with a checkmark and strikes through their label", () => {
    const markup = renderToStaticMarkup(
      createElement(GuidedChecklist, {
        heading: "Get your first board reviewed",
        steps: [
          { id: "connect", label: "Connect GitHub App", status: "done" },
          {
            id: "link",
            label: "Link a repository with a hardware project",
            status: "current",
            href: "/setup",
            actionLabel: "Start",
          },
          { id: "pr", label: "Open a pull request to trigger the first run", status: "upcoming" },
        ],
      }),
    );
    expect(markup).toContain("Get your first board reviewed");
    expect(markup).toContain("Connect GitHub App");
    expect(markup).toContain("line-through");
    expect(markup).toContain('href="/setup"');
    expect(markup).toContain("Start");
  });

  it("renders exactly one current step's action link, never more than one", () => {
    const markup = renderToStaticMarkup(
      createElement(GuidedChecklist, {
        heading: "Setup",
        steps: [
          { id: "a", label: "A", status: "current", href: "/a", actionLabel: "Go" },
          { id: "b", label: "B", status: "upcoming" },
        ],
      }),
    );
    expect((markup.match(/href="\/a"/gu) ?? []).length).toBe(1);
  });
});
