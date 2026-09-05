# Customer-Hosted Private Runner Quickstart

This guide explains how enterprise engineering teams and defense/aerospace contractors deploy self-hosted BoardReadyOps runner agents inside private VPCs, air-gapped clusters, or local on-premises workstations.

---

## 1. Architecture & Security Model

```
┌─────────────────────────────────┐
│     Customer Private VPC        │
│                                 │
│  ┌───────────────────────────┐  │      Outbound HTTPS (443) Only
│  │ Private Runner Agent      │  ├─────────────────────────────────► ┌───────────────────────────┐
│  │ - Docker / Kubernetes Pod │  │                                    │ BoardReadyOps Control     │
│  │ - Ephemeral File System   │  │                                    │ Plane (SaaS or Dedicated) │
│  │ - Hardware Licensing (CAD)│  │                                    └───────────────────────────┘
│  └───────────────────────────┘  │
│    Zero Inbound Ports Exposed   │
└─────────────────────────────────┘
```

- **Zero Inbound Ports:** The runner dials out to the control plane over TLS using secure signed polling requests. No public IP or inbound firewall hole is required.
- **Ephemeral Workspaces:** All CAD design files, Gerber layers, and netlists are decrypted into temporary scratch volumes and wiped immediately upon job completion.
- **Hardware License Compatibility:** Allows teams with existing Altium Designer or Cadence Allegro floating network licenses to execute headless exports inside their secure environment.

---

## 2. Prerequisites

1. Docker 24.0+ and Docker Compose v2.
2. A BoardReadyOps Business or Enterprise plan.
3. An active runner enrollment token generated under **Workspace Settings -> Runners -> Enroll Runner**.

---

## 3. Quickstart Deployment

### Step 1: Clone Configuration

Download the pre-configured runner compose template from the BoardReadyOps repository:

```bash
mkdir -p boardreadyops-runner && cd boardreadyops-runner
curl -fsSL https://raw.githubusercontent.com/oaslananka/boardreadyops/main/deploy/runner/docker-compose.runner.yml -o docker-compose.yml
```

### Step 2: Configure Environment

Create an `.env` file in the runner directory:

```bash
RUNNER_CONTROL_PLANE_URL=https://app.boardreadyops.com
RUNNER_ENROLLMENT_TOKEN=bro_rtk_live_a1b2c3d4e5f6...
RUNNER_ID=vpc-prod-runner-01
RUNNER_MAX_CONCURRENT_JOBS=2
```

### Step 3: Launch Worker Agent

Start the runner daemon in detached mode:

```bash
docker compose up -d
```

### Step 4: Verify Health & Registration

Inspect runner container logs:

```bash
docker compose logs -f boardreadyops-runner
```

Expected output:
```text
[INFO] Runner vpc-prod-runner-01 activated successfully.
[INFO] Capabilities declared: kicad, altium_headless, cadence_headless, multicad_ingest.
[INFO] Polling control plane for review jobs...
```

---

## 4. Headless Desktop CAD Integration

For organizations maintaining dedicated Windows or Linux workstations with licensed CAD software, BoardReadyOps provides headless automation scripts:

### Altium Designer Batch Export
Generate a DelphiScript automation script:
```typescript
import { buildNativeCadBatchCommand } from "boardreadyops/multicad";

const batch = buildNativeCadBatchCommand("altium", "C:/Designs/Gateway.PrjPcb", "C:/Outputs");
// Executes: DXP.EXE -RRunScript -D"C:/Designs/Gateway.PrjPcb" "export_altium.pas"
```

### Cadence Allegro Batch Export
Generate a SKILL replay script:
```typescript
import { buildNativeCadBatchCommand } from "boardreadyops/multicad";

const batch = buildNativeCadBatchCommand("cadence_allegro", "/eda/boards/controller.brd", "/eda/out");
// Executes: allegro -nographics -replay "export_allegro.il"
```

---

## 5. Security Checklist
- [x] Run container with dropped Linux capabilities (`cap_drop: ALL`).
- [x] Ensure scratch workspace volume is mounted with `noexec` or cleaned between runs.
- [x] Rotate enrollment tokens every 90 days.
