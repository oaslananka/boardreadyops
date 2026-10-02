import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ProjectRowActions, WorkspaceDangerZone } from "../../../apps/web/components/projects/teardown-forms.js";
import { runCommitCopyAccessibleLabel } from "../../../apps/web/lib/accessibility-labels.js";

const action = vi.fn() as never;

describe("contextual accessible action labels", () => {
  it("includes repository and short SHA in run commit copy labels", () => {
    expect(runCommitCopyAccessibleLabel("oaslananka/boardreadyops", "abcdef1234567890")).toBe(
      "Copy commit abcdef1 for oaslananka/boardreadyops",
    );
  });

  it("includes the project name in compact row action labels", () => {
    const html = renderToStaticMarkup(
      createElement(ProjectRowActions, {
        projectId: "project-1",
        projectName: "Gateway Controller",
        revisions: 2,
        deliveries: 1,
        canRename: true,
        canDelete: true,
        renameAction: action,
        deleteAction: action,
      }),
    );

    expect(html).toContain('aria-label="Rename project Gateway Controller"');
    expect(html).toContain('aria-label="Delete project Gateway Controller"');
    expect(html).toContain(">Rename</button>");
    expect(html).toContain(">Delete</button>");
  });

  it("includes the workspace name in the rename action label", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceDangerZone, {
        workspaceId: "workspace-1",
        workspaceName: "Hardware Team",
        projects: 3,
        revisions: 8,
        deliveries: 2,
        canRename: true,
        canDelete: true,
        renameAction: action,
        deleteAction: action,
      }),
    );

    expect(html).toContain('aria-label="Rename workspace Hardware Team"');
    expect(html).toContain('aria-label="Delete workspace Hardware Team"');
  });
});
