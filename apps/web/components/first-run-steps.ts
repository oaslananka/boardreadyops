import type { GuidedChecklistStep } from "./guided-checklist.js";

/** Share the verified setup sequence between Dashboard and Runs first-use states. */
export function firstRunSetupSteps(hasInstallation: boolean): readonly GuidedChecklistStep[] {
  return [
    {
      id: "install",
      label: "Connect the BoardReadyOps GitHub App",
      status: hasInstallation ? "done" : "current",
      ...(!hasInstallation
        ? { href: "https://github.com/apps/boardreadyops/installations/new", actionLabel: "Install" }
        : {}),
    },
    {
      id: "setup",
      label: "Choose a hardware repository and open its setup pull request",
      status: hasInstallation ? "current" : "upcoming",
      ...(hasInstallation ? { href: "/setup", actionLabel: "Start setup" } : {}),
    },
    { id: "merge", label: "Merge the reviewed setup pull request", status: "upcoming" },
    {
      id: "run",
      label: "Validate readiness before the first hardware run, then open a hardware PR",
      status: "upcoming",
    },
  ];
}
