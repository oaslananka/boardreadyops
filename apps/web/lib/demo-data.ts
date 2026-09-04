import type {
  EvidenceState,
  FindingDiffState,
  FindingDisposition,
  ReviewDecision,
  ReviewStatus,
  SnapshotArtifact,
} from "@boardreadyops/contracts";

export interface DemoFinding {
  fingerprint: string;
  ruleId: string;
  severity: "critical" | "error" | "warning" | "info";
  path: string;
  message: string;
  sheet?: string | undefined;
  component?: string | undefined;
  diffState: FindingDiffState;
  disposition: FindingDisposition;
  decisionReason?: string | undefined;
  decisionOwner?: string | undefined;
  decisionExpiresAt?: string | null | undefined;
  assignees: string[];
}

export interface DemoComment {
  id: string;
  findingFingerprint?: string | undefined;
  authorId: string;
  authorType: "internal" | "guest" | "system";
  content: string;
  status: "open" | "resolved" | "outdated";
  createdAt: string;
}

export interface DemoChecklistItem {
  id: string;
  title: string;
  completed: boolean;
  completedBy?: string | undefined;
  completedAt?: string | undefined;
}

export interface DemoApproval {
  id: string;
  approverId: string;
  status: "approved" | "changes_requested" | "invalidated" | "dismissed";
  reason?: string | undefined;
  isBreakGlass?: boolean | undefined;
  evidenceDigest: string;
  createdAt: string;
  invalidatedAt?: string | undefined;
  invalidationReason?: string | undefined;
}

export interface DemoEvidenceItem {
  id?: string | undefined;
  name: string;
  type: "bom" | "drc" | "netlist" | "schematic" | "pcb" | "manifest";
  path: string;
  sha256: string;
  sizeBytes: number;
  verified?: boolean | undefined;
}

export interface DemoReview {
  id: string;
  repositoryId: string;
  repositoryName: string;
  pullRequestNumber: number;
  title: string;
  status: ReviewStatus;
  decision: ReviewDecision;
  currentRevisionId: string;
  currentRevisionSequence: number;
  baseCommitSha: string;
  headCommitSha: string;
  evidenceDigest: string;
  evidenceState: EvidenceState;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  findings: DemoFinding[];
  comments: DemoComment[];
  checklist: DemoChecklistItem[];
  approvals: DemoApproval[];
  evidenceItems: DemoEvidenceItem[];
  changedFiles?: DemoChangedFile[] | undefined;
  bomChanges?: DemoBomChange[] | undefined;
  /** Populated server-side (see `getDemoReview`); absent on the static fixtures below. */
  headSnapshots?: SnapshotArtifact[] | undefined;
  /** Snapshots for the revision's base commit, when a prior run recorded them; enables overlay/diff canvas modes. */
  baseSnapshots?: SnapshotArtifact[] | undefined;
}

type DemoChangedFile = {
  path: string;
  status: "modified" | "added" | "deleted";
  changesCount: number;
};

interface DemoBomChange {
  reference: string;
  changeType: "added" | "removed" | "modified";
  baseMpn?: string | undefined;
  headMpn?: string | undefined;
  manufacturer?: string | undefined;
}

export const DEMO_REVIEWS: DemoReview[] = [
  {
    id: "rev_gateway_42",
    repositoryId: "repo_industrial_iot",
    repositoryName: "acme-hardware/industrial-iot-gateway",
    pullRequestNumber: 42,
    title: "Upgrade PMIC to MP2617 and add CAN FD transceiver isolation",
    status: "active",
    decision: "pending",
    currentRevisionId: "rev_rev_002",
    currentRevisionSequence: 2,
    baseCommitSha: "7b4a2c1f",
    headCommitSha: "e93d81b4",
    evidenceDigest: "9f82c4bc98e1f5a892b34720e11894d80a183592bc49195b05a76644f128c7bb",
    evidenceState: "current",
    createdBy: "sarah.chen@acme.corp",
    createdAt: "2026-08-25T14:20:00Z",
    updatedAt: "2026-08-27T10:15:00Z",
    changedFiles: [
      { path: "hardware/mainboard/power_mgmt.kicad_sch", status: "modified", changesCount: 14 },
      { path: "hardware/mainboard/can_fd_isolated.kicad_sch", status: "added", changesCount: 48 },
      { path: "hardware/mainboard/industrial_gateway.kicad_pcb", status: "modified", changesCount: 86 },
      { path: "hardware/bom/mainboard_bom.csv", status: "modified", changesCount: 6 },
    ],
    bomChanges: [
      { reference: "U12", changeType: "added", headMpn: "ISO1042BDWR", manufacturer: "Texas Instruments" },
      {
        reference: "U1",
        changeType: "modified",
        baseMpn: "BQ24195RGER",
        headMpn: "MP2617GL-Z",
        manufacturer: "Monolithic Power Systems",
      },
      { reference: "C12", changeType: "modified", baseMpn: "GRM31CR71H106KA12L", manufacturer: "Murata" },
    ],
    findings: [
      {
        fingerprint: "fp_drc_clearance_iso_01",
        ruleId: "kicad/track-clearance",
        severity: "error",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        message:
          "High-voltage clearance violation: Clearance between ISO_CAN_VCC and GND is 0.35mm (min required: 0.50mm for reinforced isolation).",
        sheet: "can_fd_isolated",
        component: "U12 (ISO1042)",
        diffState: "new",
        disposition: "open",
        assignees: ["sarah.chen@acme.corp"],
      },
      {
        fingerprint: "fp_silk_pad_j3",
        ruleId: "kicad/silk-over-pad",
        severity: "warning",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        message: "Silkscreen legend overlaps test point TP_GND copper pad by 0.12mm.",
        sheet: "power_mgmt",
        component: "TP_GND",
        diffState: "persistent",
        disposition: "accepted_risk",
        decisionReason:
          "Reviewed by manufacturing engineer: silkscreen is non-conductive clipping applied at Gerber export stage.",
        decisionOwner: "mfg-lead@acme.corp",
        decisionExpiresAt: null,
        assignees: ["mfg-lead@acme.corp"],
      },
      {
        fingerprint: "fp_bom_mpn_c12",
        ruleId: "bom/missing-mpn",
        severity: "error",
        path: "hardware/bom/mainboard_bom.csv",
        message: "Capacitor C12 (10uF 50V 1210) has empty Manufacturer Part Number in schematic property fields.",
        sheet: "power_mgmt",
        component: "C12",
        diffState: "new",
        disposition: "open",
        assignees: ["sarah.chen@acme.corp"],
      },
      {
        fingerprint: "fp_thermal_relief_gnd",
        ruleId: "kicad/thermal-relief",
        severity: "warning",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        message:
          "Power inductor L2 GND pad has solid connection to In1.Cu without thermal spokes (may cause soldering difficulty).",
        sheet: "power_mgmt",
        component: "L2 (MSS1278)",
        diffState: "persistent",
        disposition: "accepted_risk",
        decisionReason:
          "Solid ground connection intentional for maximum thermal dissipation into 2oz inner copper plane.",
        decisionOwner: "sarah.chen@acme.corp",
        decisionExpiresAt: null,
        assignees: [],
      },
      {
        fingerprint: "fp_unconnected_net_usb",
        ruleId: "kicad/unconnected-net",
        severity: "error",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        message: "Unrouted segment on net USB_D_P between ESD protection D4 and USB-C receptacle J1.",
        sheet: "mainboard",
        component: "D4",
        diffState: "regressed",
        disposition: "open",
        assignees: ["sarah.chen@acme.corp"],
      },
      {
        fingerprint: "fp_courtyard_u4",
        ruleId: "kicad/courtyard-overlap",
        severity: "warning",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        message: "Courtyard overlap between U4 (SOIC-8) and adjacent bypass capacitor C8.",
        sheet: "power_mgmt",
        component: "U4",
        diffState: "resolved",
        disposition: "fixed",
        decisionReason: "Moved C8 0.4mm north in Revision 2.",
        decisionOwner: "sarah.chen@acme.corp",
        assignees: [],
      },
    ],
    comments: [
      {
        id: "cmt_101",
        findingFingerprint: "fp_drc_clearance_iso_01",
        authorId: "alex.kumar@acme.corp",
        authorType: "internal",
        content:
          "We must adhere to IEC 62368-1 table for reinforced barrier clearance. Let's widen the isolation moat under U12.",
        status: "open",
        createdAt: "2026-08-26T09:30:00Z",
      },
      {
        id: "cmt_102",
        findingFingerprint: "fp_drc_clearance_iso_01",
        authorId: "sarah.chen@acme.corp",
        authorType: "internal",
        content: "Agreed. I will route the ISO_CAN_VCC trace on layer 3 and keep 0.8mm clearance.",
        status: "open",
        createdAt: "2026-08-26T11:15:00Z",
      },
      {
        id: "cmt_103",
        authorId: "alex.kumar@acme.corp",
        authorType: "internal",
        content:
          "Overall power architecture looks solid. Once the clearance and unrouted USB track are addressed, this is good to fab.",
        status: "open",
        createdAt: "2026-08-26T16:00:00Z",
      },
    ],
    checklist: [
      {
        id: "chk_01",
        title: "Verify buck converter inductor saturation current > peak switch current (3.8A)",
        completed: true,
        completedBy: "sarah.chen@acme.corp",
        completedAt: "2026-08-25T16:00:00Z",
      },
      {
        id: "chk_02",
        title: "Confirm galvanic isolation rating meets 2.5kVrms for industrial fieldbus port",
        completed: false,
      },
      {
        id: "chk_03",
        title: "Check test point accessibility for bed-of-nails ICT fixture",
        completed: true,
        completedBy: "mfg-lead@acme.corp",
        completedAt: "2026-08-26T14:30:00Z",
      },
      {
        id: "chk_04",
        title: "Validate pin mapping between MCU GPIOs and transceiver control lines",
        completed: false,
      },
    ],
    approvals: [
      {
        id: "app_prev_rev",
        approverId: "alex.kumar@acme.corp",
        status: "invalidated",
        reason: "Approved Rev 1 baseline",
        evidenceDigest: "3c842b10a9e7f82b012948271049281726354819203948571625341829304152",
        createdAt: "2026-08-24T18:00:00Z",
        invalidatedAt: "2026-08-25T14:20:00Z",
        invalidationReason: "Evidence digest changed when Revision 2 was published with new commits.",
      },
    ],
    evidenceItems: [
      {
        name: "mainboard_bom.csv",
        type: "bom",
        path: "hardware/bom/mainboard_bom.csv",
        sha256: "8e9201fba4567890123456789abcdef0123456789abcdef0123456789abcdef0",
        sizeBytes: 14280,
      },
      {
        name: "drc_report.json",
        type: "drc",
        path: "reports/drc_report.json",
        sha256: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
        sizeBytes: 8940,
      },
      {
        name: "industrial_gateway.kicad_pcb",
        type: "pcb",
        path: "hardware/mainboard/industrial_gateway.kicad_pcb",
        sha256: "4f5e6d7c8b9a0f1e2d3c4b5a6f7e8d9c0b1a2f3e4d5c6b7a8f9e0d1c2b3a4f5e",
        sizeBytes: 482010,
      },
      {
        name: "manifest.json",
        type: "manifest",
        path: "release/manifest.json",
        sha256: "9f82c4bc98e1f5a892b34720e11894d80a183592bc49195b05a76644f128c7bb",
        sizeBytes: 3120,
      },
    ],
  },
  {
    id: "rev_edge_ble_09",
    repositoryId: "repo_ble_sensor",
    repositoryName: "acme-hardware/ble-environmental-sensor",
    pullRequestNumber: 9,
    title: "Switch to nRF52840 WLCSP and optimize antenna matching circuit",
    status: "awaiting_decision",
    decision: "approved",
    currentRevisionId: "rev_ble_001",
    currentRevisionSequence: 1,
    baseCommitSha: "11223344",
    headCommitSha: "55667788",
    evidenceDigest: "b2a184c798e1f5a892b34720e11894d80a183592bc49195b05a76644f128c7bb",
    evidenceState: "current",
    createdBy: "david.wong@acme.corp",
    createdAt: "2026-08-26T10:00:00Z",
    updatedAt: "2026-08-27T08:00:00Z",
    changedFiles: [
      { path: "rf/ble_sensor.kicad_pcb", status: "modified", changesCount: 32 },
      { path: "rf/antenna_matching.kicad_sch", status: "modified", changesCount: 12 },
    ],
    bomChanges: [
      {
        reference: "U1",
        changeType: "modified",
        baseMpn: "NRF52840-QIAA",
        headMpn: "NRF52840-QFAA",
        manufacturer: "Nordic Semiconductor",
      },
    ],
    findings: [
      {
        fingerprint: "fp_ble_via_01",
        ruleId: "kicad/microvia-aspect",
        severity: "warning",
        path: "rf/ble_sensor.kicad_pcb",
        message: "Microvia aspect ratio 0.8:1 is within JLCPCB advanced capabilities.",
        sheet: "rf_front_end",
        component: "VIA_RF_1",
        diffState: "persistent",
        disposition: "accepted_risk",
        decisionReason: "JLCPCB 4-layer HDI tier confirmed by fab quote #JL-9948.",
        decisionOwner: "david.wong@acme.corp",
        assignees: [],
      },
    ],
    comments: [],
    checklist: [
      {
        id: "chk_ble_01",
        title: "VNA return loss measurement simulation S11 < -15dB at 2.44GHz",
        completed: true,
        completedBy: "david.wong@acme.corp",
        completedAt: "2026-08-26T14:00:00Z",
      },
    ],
    approvals: [
      {
        id: "app_ble_01",
        approverId: "rf-expert@acme.corp",
        status: "approved",
        reason: "Matching network topology and feedline impedance 50.2 ohms verified.",
        evidenceDigest: "b2a184c798e1f5a892b34720e11894d80a183592bc49195b05a76644f128c7bb",
        createdAt: "2026-08-27T08:00:00Z",
      },
    ],
    evidenceItems: [],
  },
];

export function getDemoReview(id: string): DemoReview | undefined {
  return DEMO_REVIEWS.find((r) => r.id === id || r.pullRequestNumber.toString() === id);
}
