# ICP (Ideal Customer Profile) & Jobs To Be Done (JTBD)

## Ideal Customer Profile (ICP)

### Primary Segment: Mid-Market & Enterprise Hardware Engineering Teams
- **Team Size:** 5–100 electrical, PCB, and hardware engineers.
- **Tech Stack:** KiCad 8+, GitHub / GitHub Actions, CI/CD automated release pipelines.
- **Pain Point:** Manual design rule reviews, fragmented BOM/sourcing validation, compliance risk in hardware manufacturing release.
- **Value Proposition:** Automated, continuous release preflight and provenance verification for hardware designs directly in CI.

## Jobs To Be Done (JTBD)

### 1. Preflight Verification Before Fab
- **When I:** Prepare to release a hardware design to fabrication,
- **I want to:** Automatically verify DRC, ERC, BOM completeness, and manufacturing outputs in CI,
- **So that:** I prevent costly PCB respins and manufacturing delays before sending files to the CM.

### 2. Sourcing and Component Risk Audit
- **When I:** Select components for a design revision,
- **I want to:** Check MPNs against EOL, single-source, and footprint mismatch risks,
- **So that:** The design remains buildable and supply-chain resilient.

### 3. Provenance and Release Assurance
- **When I:** Finalize release artifacts for production,
- **I want to:** Generate and cryptographically verify source-to-artifact provenance manifests,
- **So that:** The exact source revision and tool build that produced the fabrication outputs are verifiably bound.

## Licensing Wording Standard
- **Source Available:** Core functionality is licensed under PolyForm Noncommercial 1.0.
- **Community Edition:** Free for non-commercial individual repositories and personal projects under PolyForm Noncommercial terms.
