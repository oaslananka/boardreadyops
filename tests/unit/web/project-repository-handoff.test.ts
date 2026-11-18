/**
 * @vitest-environment happy-dom
 */

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { createProjectAction } from "../../../apps/web/app/projects/actions.js";
import { CreateProjectForm } from "../../../apps/web/components/projects/workspace-forms.js";
import { ToastProvider } from "../../../apps/web/components/ui/toast.js";
import { authorizedProjectRepositoryHint } from "../../../apps/web/lib/project-repository-hint.js";

const repositories = [
  { owner: "owner", name: "Hardware", private: true },
  { owner: "other-org", name: "Hardware", private: false },
];

describe("project repository navigation hint", () => {
  it("matches only a viewer-authorized repository and preserves its actual name", () => {
    expect(authorizedProjectRepositoryHint("OWNER/HARDWARE", repositories)).toBe("owner/Hardware");
    expect(authorizedProjectRepositoryHint("other-org/hardware", repositories)).toBe("other-org/Hardware");
  });

  it("does not turn an unknown, malformed, or missing hint into a different repository selection", () => {
    expect(authorizedProjectRepositoryHint("outsider/Hardware", repositories)).toBeUndefined();
    expect(authorizedProjectRepositoryHint("../Hardware", repositories)).toBeUndefined();
    expect(authorizedProjectRepositoryHint(undefined, repositories)).toBeUndefined();
  });

  it("preselects the authorized project repository without submitting anything", () => {
    const action = vi.fn() as unknown as typeof createProjectAction;
    const markup = renderToStaticMarkup(
      createElement(
        ToastProvider,
        {},
        createElement(CreateProjectForm, {
          workspaceId: "ws-1",
          action,
          repositories,
          repositoryListUnavailable: false,
          initialRepository: authorizedProjectRepositoryHint("OWNER/HARDWARE", repositories),
        }),
      ),
    );
    const select = document.createElement("div");
    select.innerHTML = markup;
    expect(select.querySelector<HTMLSelectElement>('select[name="githubRepoFullName"]')?.value).toBe("owner/Hardware");
    expect(action).not.toHaveBeenCalled();
  });
});
