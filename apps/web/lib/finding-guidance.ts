/**
 * Guidance is deliberately advisory. We never infer a KiCad coordinate, net,
 * component, or source line that the runner did not report.
 */
export type FindingDomain =
  | "electrical"
  | "manufacturability"
  | "assembly"
  | "sourcing"
  | "release"
  | "testability"
  | "unclassified";

export function findingDomainFromRule(ruleId: string): FindingDomain {
  if (
    ruleId.startsWith("erc.") ||
    ruleId.startsWith("drc.") ||
    ruleId.startsWith("firmware.") ||
    ruleId.startsWith("pinmap.")
  )
    return "electrical";
  if (ruleId.startsWith("release.")) return "release";
  if (ruleId.startsWith("bom.")) return "sourcing";
  if (ruleId.startsWith("manufacturing.") || ruleId.startsWith("design.")) return "manufacturability";
  return "unclassified";
}

const ruleSteps: Readonly<Record<string, string>> = {
  "erc.footprint_filter":
    "In the schematic symbol properties, compare Footprint Filters with the assigned footprint. Select a compatible footprint or correct the filters, then run KiCad ERC.",
  "erc.four_way_junction":
    "Inspect the four-way junction in the schematic. Confirm the nets really should connect; if not, reroute the wires as separate connections and rerun ERC.",
  "erc.label_dangling":
    "Inspect the schematic label and its wire connection. Attach it to the intended net, or remove an unused label, then rerun ERC.",
  "erc.simulation_model_issue":
    "Check the symbol's SPICE simulation model settings and referenced model file. Repair the missing or invalid model configuration before rerunning ERC.",
  "erc.single_global_label":
    "Inspect the global label and intended net. Connect the matching destination label, or use an appropriate local label if only one sheet needs the net.",
  "erc.footprint_link_issues":
    "Check the assigned footprint name and the KiCad footprint library table. Make sure the referenced library and footprint are available, then rerun ERC.",
  "drc.lib_footprint_issues":
    "Check the PCB footprint library reference and KiCad library table. Repair any missing or invalid footprint library before rerunning DRC.",
  "drc.silk_edge_clearance":
    "Inspect silkscreen objects near Edge.Cuts. Move or resize offending markings to meet the fabrication clearance rules, then rerun DRC.",
  "release.changelog-present":
    "Add or update CHANGELOG.md in the repository with the board revision and changes, commit it, then rerun the release checks.",
  "bom.missing-mpn":
    "Supply a verifiable manufacturer part number for the affected populated BOM entry; regenerate the BOM and rerun the check.",
  "manufacturing.outputs-present":
    "Generate the required fabrication outputs from the current source revision and verify the output manifest before rerunning readiness.",
};

export function findingGuidance(ruleId: string): string {
  const exact = ruleSteps[ruleId];
  if (exact) return exact;
  const domain = findingDomainFromRule(ruleId);
  switch (domain) {
    case "electrical":
      return ruleId.startsWith("drc.")
        ? "Review the diagnostic in KiCad's PCB Design Rules Checker, correct the relevant board geometry or rule settings, then rerun DRC."
        : "Review the diagnostic in the schematic or firmware source, correct the affected connection or configuration, then rerun the check.";
    case "manufacturability":
      return "Check the indicated board or manufacturing output against the fabrication requirements, correct the source or generated package, then rerun the check.";
    case "sourcing":
      return "Inspect the affected bill of materials entry, correct the component or sourcing data and regenerate the BOM before rerunning.";
    case "release":
      return "Review the repository release documentation and package metadata for the exact revision, make the required correction, commit it and rerun.";
    case "assembly":
    case "testability":
      return "Review the finding's assembly or test requirements and correct the affected source data before rerunning.";
    default:
      return "Review the finding message and original workflow evidence to identify the affected source or output. Correct it and rerun the check.";
  }
}

export function githubFindingSourceUrl(
  repository: string,
  commitSha: string,
  path: string | undefined,
): string | undefined {
  if (!path || path === "." || path.length > 1024) return undefined;
  if (!/^[\w.-]+\/[\w.-]+$/u.test(repository) || !/^[a-f0-9]{40}$/iu.test(commitSha)) return undefined;
  const segments = path.split("/");
  if (segments.some((part) => !part || part === "." || part === ".." || part.includes("\\") || /[\r\n?#]/u.test(part)))
    return undefined;
  return `https://github.com/${repository}/blob/${commitSha}/${segments.map(encodeURIComponent).join("/")}`;
}
