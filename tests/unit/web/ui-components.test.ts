/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  Alert,
  Breadcrumbs,
  Definition,
  DefinitionGrid,
  EmptyState,
  humanize,
  Pagination,
  Panel,
  StatusBadge,
  statusTone,
} from "../../../apps/web/components/ui.js";

describe("ui.tsx shared component contract", () => {
  it("humanize and statusTone keep their existing behavior", () => {
    expect(humanize("in_progress")).toBe("In Progress");
    expect(humanize(undefined)).toBe("Unknown");
    expect(statusTone("failed")).toBe("danger");
    expect(statusTone("pass")).toBe("success");
    expect(statusTone("queued")).toBe("info");
    expect(statusTone("something-unmapped")).toBe("neutral");
  });

  it("StatusBadge renders the humanized value and status color, never a decorative color", () => {
    const markup = renderToStaticMarkup(createElement(StatusBadge, { value: "failed" }));
    expect(markup).toContain("Failed");
    expect(markup).toContain("text-danger");
  });

  it("Breadcrumbs links every item except the last", () => {
    const markup = renderToStaticMarkup(
      createElement(Breadcrumbs, { items: [{ href: "/", label: "Home" }, { label: "Dashboard" }] }),
    );
    expect(markup).toContain('href="/"');
    expect(markup).toContain('aria-current="page"');
  });

  it("Panel renders title, description, and actions", () => {
    const markup = renderToStaticMarkup(
      createElement(Panel, { title: "Engineering status", description: "Current scope", id: "status" }, "body"),
    );
    expect(markup).toContain("Engineering status");
    expect(markup).toContain("Current scope");
    expect(markup).toContain("body");
  });

  it("DefinitionGrid/Definition render label/value pairs", () => {
    const markup = renderToStaticMarkup(
      createElement(DefinitionGrid, null, createElement(Definition, { label: "Plan" }, "free")),
    );
    expect(markup).toContain("Plan");
    expect(markup).toContain("free");
  });

  it("Alert renders role=alert only for the danger tone", () => {
    const danger = renderToStaticMarkup(createElement(Alert, { title: "Failed", tone: "danger" }, "detail"));
    const info = renderToStaticMarkup(createElement(Alert, { title: "Note", tone: "info" }, "detail"));
    expect(danger).toContain('role="alert"');
    expect(info).not.toContain('role="alert"');
  });

  it("EmptyState renders title, body, and an optional action", () => {
    const markup = renderToStaticMarkup(
      createElement(EmptyState, { title: "No projects configured yet", action: "Create First Project" }, "body"),
    );
    expect(markup).toContain("No projects configured yet");
    expect(markup).toContain("Create First Project");
  });

  it("Pagination renders nothing for a single page and Previous/Next otherwise", () => {
    const single = renderToStaticMarkup(
      createElement(Pagination, {
        basePath: "/reviews",
        page: 1,
        totalPages: 1,
        pageParameter: "page",
        searchParameters: {},
      }),
    );
    expect(single).toBe("");

    const multi = renderToStaticMarkup(
      createElement(Pagination, {
        basePath: "/reviews",
        page: 2,
        totalPages: 3,
        pageParameter: "page",
        searchParameters: {},
      }),
    );
    expect(multi).toContain("Previous");
    expect(multi).toContain("Next");
    expect(multi).toContain("page=3");
  });
});
