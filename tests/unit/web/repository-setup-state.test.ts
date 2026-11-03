import { describe, expect, it } from "vitest";
import { deriveRepositorySetupState } from "../../../apps/web/lib/repository-setup-state.js";

describe("repository setup onboarding state", () => {
  it("starts unconfigured when no persisted setup revision exists", () => {
    expect(deriveRepositorySetupState({})).toMatchObject({
      id: "unconfigured",
      label: "Setup not started",
      currentStep: 1,
    });
  });

  it("does not invent a persisted setup for the control-plane zero sentinel", () => {
    for (const revision of [0, -1]) {
      expect(
        deriveRepositorySetupState({
          setupRevision: revision,
          setupWorkflowStatus: "ready",
          setupConfigStatus: "ready",
          setupObservedSha: "abcdef1234567890",
        }),
      ).toMatchObject({
        id: "unconfigured",
        label: "Setup not started",
        currentStep: 1,
      });
    }
  });

  it("moves to validation pending once a setup revision exists", () => {
    expect(
      deriveRepositorySetupState({
        setupRevision: 2,
        setupWorkflowStatus: "unknown",
        setupConfigStatus: "unknown",
      }),
    ).toMatchObject({
      id: "validation_pending",
      currentStep: 4,
    });
  });

  it("surfaces an explicit workflow or configuration problem as attention", () => {
    const state = deriveRepositorySetupState({
      setupRevision: 3,
      setupWorkflowStatus: "missing",
      setupConfigStatus: "ready",
    });
    expect(state.id).toBe("attention");
    expect(state.description).toContain("workflow missing");
  });

  it("refuses a verified badge when the current setup lacks a recorded commit", () => {
    for (const sha of [undefined, "", "not-a-commit", "a".repeat(39)]) {
      const result = deriveRepositorySetupState({
        setupRevision: 5,
        setupWorkflowStatus: "ready",
        setupConfigStatus: "ready",
        ...(sha === undefined ? {} : { setupObservedSha: sha }),
      });
      expect(result).toMatchObject({ id: "attention", label: "Setup needs attention", currentStep: 4 });
      expect(result.description).toContain("verified Git commit");
      expect(result.description).toContain("Validate readiness");
    }
  });

  it("becomes ready only when both persisted readiness dimensions are ready", () => {
    const state = deriveRepositorySetupState({
      setupRevision: 4,
      setupWorkflowStatus: "ready",
      setupConfigStatus: "ready",
      setupObservedSha: "abcdef1234567890abcdef1234567890abcdef12",
    });
    expect(state).toMatchObject({
      id: "ready",
      label: "Repository setup verified",
      currentStep: 4,
    });
    expect(state.description).toContain("abcdef12");
  });
});
