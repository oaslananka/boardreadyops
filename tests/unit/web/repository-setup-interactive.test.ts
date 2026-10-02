import {
  repositorySetupPresets,
  repositorySetupWorkflowContractVersion,
  repositorySetupWorkflowPath,
} from "@boardreadyops/cloud-core/repository-setup";
import { Window } from "happy-dom";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RepositorySetupInteractive } from "../../../apps/web/components/repository-setup-interactive.js";

describe("repository setup interactive readiness", () => {
  it("disables readiness validation until a persisted setup revision exists", async () => {
    const markup = renderToStaticMarkup(
      createElement(RepositorySetupInteractive, {
        presets: repositorySetupPresets,
        initialPresetId: "prototype",
        presetVersion: 1,
        workflowPath: repositorySetupWorkflowPath,
        workflowContractVersion: repositorySetupWorkflowContractVersion,
        workflowSource: "https://github.test/oaslananka/boardreadyops/readiness-runner.yml",
        signedIn: true,
        repositories: [
          {
            id: "repository-1",
            fullName: "octo/board",
            accountLogin: "octo",
          },
        ],
      }),
    );

    const window = new Window({ url: "https://boardreadyops.example/setup" });
    window.document.write(markup);
    const button = [...window.document.querySelectorAll("button")].find((candidate) =>
      candidate.textContent?.includes("Validate readiness now"),
    );

    expect(button).toBeDefined();
    expect(button?.hasAttribute("disabled")).toBe(true);
    expect(markup).toContain(
      "Open the setup pull request first so BoardReadyOps has a persisted policy revision to validate.",
    );

    await window.close();
  });
});
