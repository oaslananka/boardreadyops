import { registerRule } from "../core/rule-registry.js";
import { complianceRule } from "./bom/compliance.js";
import { dnpConsistencyRule } from "./bom/dnp-consistency.js";
import { eolDetectionRule } from "./bom/eol-detection.js";
import { footprintMismatchRule } from "./bom/footprint-mismatch.js";
import { identityConflictsRule } from "./bom/identity-conflicts.js";
import { lifecycleRule } from "./bom/lifecycle.js";
import { missingMpnRule } from "./bom/missing-mpn.js";
import { bomRiskScoreRule } from "./bom/risk-score.js";
import { singleSourceRule } from "./bom/single-source.js";
import { unknownLifecycleRule } from "./bom/unknown-lifecycle.js";
import { variantConsistencyRule } from "./bom/variant-consistency.js";
import { boardOutlineRule } from "./design/board-outline.js";
import { copperBalanceRule } from "./design/copper-balance.js";
import { uniqueReferencesRule } from "./design/unique-references.js";
import { runDrcRule } from "./drc/run-drc.js";
import { runErcRule } from "./erc/run-erc.js";
import { arduinoPinContractRule } from "./firmware/arduino-pin-contract.js";
import { espIdfPinContractRule } from "./firmware/esp-idf-pin-contract.js";
import { platformioPinContractRule } from "./firmware/platformio-pin-contract.js";
import { stm32CubeMxPinContractRule } from "./firmware/stm32cubemx-pin-contract.js";
import { zephyrPinContractRule } from "./firmware/zephyr-pin-contract.js";
import { assemblySidesRule } from "./manufacturing/assembly-sides.js";
import { drillCoverageRule } from "./manufacturing/drill-coverage.js";
import { fabNotesRule } from "./manufacturing/fab-notes.js";
import { fiducialsRule } from "./manufacturing/fiducials.js";
import { jobsetOutputsRule } from "./manufacturing/jobset-outputs.js";
import { layerStackupRule } from "./manufacturing/layer-stackup.js";
import { outputsPresentRule } from "./manufacturing/outputs-present.js";
import { packageCompletenessRule } from "./manufacturing/package-completeness.js";
import { panelSanityRule } from "./manufacturing/panel-sanity.js";
import { pin1MarkersRule } from "./manufacturing/pin1-markers.js";
import { polarityMarkersRule } from "./manufacturing/polarity-markers.js";
import { positionCoverageRule } from "./manufacturing/position-coverage.js";
import { silkscreenOverPadRule } from "./manufacturing/silkscreen-over-pad.js";
import { testPointsRule } from "./manufacturing/test-points.js";
import { toolingHolesRule } from "./manufacturing/tooling-holes.js";
import { pinmapNetLabelRule } from "./pinmap/net-label.js";
import { pinmapCollisionRule, pinmapUnmappedPinRule, pinmapVerifyRule } from "./pinmap/verify.js";
import { changelogPresentRule } from "./release/changelog-present.js";
import { revisionSetRule } from "./release/revision-set.js";
import { tagMatchesRevisionRule } from "./release/tag-matches-revision.js";
import { versionFormatRule } from "./release/version-format.js";

let registered = false;

export function registerBuiltInRules(): void {
  if (registered) {
    return;
  }
  [
    runDrcRule,
    runErcRule,
    missingMpnRule,
    singleSourceRule,
    identityConflictsRule,
    bomRiskScoreRule,
    eolDetectionRule,
    lifecycleRule,
    unknownLifecycleRule,
    footprintMismatchRule,
    dnpConsistencyRule,
    variantConsistencyRule,
    complianceRule,
    copperBalanceRule,
    boardOutlineRule,
    uniqueReferencesRule,
    pinmapVerifyRule,
    pinmapUnmappedPinRule,
    pinmapCollisionRule,
    pinmapNetLabelRule,
    platformioPinContractRule,
    arduinoPinContractRule,
    zephyrPinContractRule,
    espIdfPinContractRule,
    stm32CubeMxPinContractRule,
    outputsPresentRule,
    packageCompletenessRule,
    jobsetOutputsRule,
    panelSanityRule,
    fabNotesRule,
    drillCoverageRule,
    layerStackupRule,
    fiducialsRule,
    testPointsRule,
    assemblySidesRule,
    toolingHolesRule,
    positionCoverageRule,
    polarityMarkersRule,
    pin1MarkersRule,
    silkscreenOverPadRule,
    revisionSetRule,
    changelogPresentRule,
    tagMatchesRevisionRule,
    versionFormatRule,
  ].forEach(registerRule);
  registered = true;
}

export function resetBuiltInRuleRegistrationForTests(): void {
  registered = false;
}
