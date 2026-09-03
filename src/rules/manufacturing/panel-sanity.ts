import { configFor, configuredSeverity, finding, rule, shouldRun } from "../helpers.js";

export const panelSanityRule = rule(
  {
    id: "manufacturing.panel-sanity",
    title: "Panelization output is missing",
    description: "Checks panelized manufacturing configurations for panel output files.",
    rationale: "Panelized jobs need the panel artifacts the assembler and fabricator expect.",
    defaultSeverity: "medium",
    appliesTo: ["manifest"],
    configKeys: ["rules.manufacturing.panel-sanity.panelized"],
    kicadVersions: ["9", "10", "future"],
    tags: ["manufacturing", "panel", "outputs"],
    category: "manufacturability",
    evidenceType: "exact",
    fixability: "manual",
    vendorDependence: "profile-specific",
  },
  async (context) => {
    if (!shouldRun(context, "manufacturing.panel-sanity")) {
      return [];
    }
    const config = configFor(context, "manufacturing.panel-sanity");
    if (config.panelized !== true) {
      return [];
    }
    return [
      finding(context, {
        ruleId: "manufacturing.panel-sanity",
        severity: configuredSeverity(context, "manufacturing.panel-sanity", "medium"),
        message: "Panelization is configured but no panel output was declared.",
        path: ".",
        kind: "manifest",
      }),
    ];
  },
);
