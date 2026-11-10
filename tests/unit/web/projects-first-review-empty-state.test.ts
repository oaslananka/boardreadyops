import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WorkspaceProjectsEmptyState } from "../../../apps/web/components/projects/workspace-projects-empty-state.js";

describe("Projects first review without forced CAD workspace setup", () => {
  it("opens the viewer's already-recorded run directly instead of demanding a new project", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceProjectsEmptyState, { recordedRunId: "run/test?x=1" }));
    expect(html).toContain('href="/runs/run%2Ftest%3Fx%3D1/design"');
    expect(html).toContain("Inspect recorded design");
    expect(html).toContain("without creating a CAD workspace project");
    expect(html).toContain("not manufacturing approval");
    expect(html).not.toContain('href="/setup"');
  });

  it("sends a repository without recorded evidence to Setup, explaining project creation is optional", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceProjectsEmptyState, {}));
    expect(html).toContain('href="/setup"');
    expect(html).toContain("Review repository setup");
    expect(html).toContain("optional");
    expect(html).not.toContain("Inspect recorded design");
  });

  it("does not incorrectly claim an existing workspace has no projects when the current page is empty", () => {
    const html = renderToStaticMarkup(createElement(WorkspaceProjectsEmptyState, { hasAnyProjects: true }));
    expect(html).toContain("No projects on this page");
    expect(html).toContain('href="/projects"');
    expect(html).not.toContain("No CAD workspace projects yet");
  });
});
