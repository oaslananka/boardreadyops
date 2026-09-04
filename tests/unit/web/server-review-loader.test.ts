import { beforeEach, describe, expect, it, vi } from "vitest";
import * as cloudConfig from "../../../apps/web/lib/cloud-runtime-config.js";
import { loadServerReview } from "../../../apps/web/lib/server-review-loader.js";
import type { UserSession } from "../../../apps/web/lib/user-session.js";

const mockLoaderQuery = vi.fn();
const mockLoaderClose = vi.fn();

vi.mock("@boardreadyops/db/pg-executor", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockLoaderQuery,
    close: mockLoaderClose,
  })),
}));

vi.mock("../../../packages/db/src/pg-executor.js", () => ({
  createPgQueryExecutor: vi.fn(() => ({
    query: mockLoaderQuery,
    close: mockLoaderClose,
  })),
}));

describe("Server-Side Authoritative Review Loader (Security & Durability)", () => {
  beforeEach(() => {
    mockLoaderQuery.mockReset();
    mockLoaderClose.mockReset();
  });

  const reviewId = "rev_db_real_42";
  const now = new Date().toISOString();
  const authorizedSession: UserSession = {
    userId: 1001,
    login: "alice",
    installationIds: [47001],
    issuedAt: now,
    expiresAt: new Date(Date.now() + 3600000).toISOString(),
  };

  it("loads and reconstructs authoritative review with real findings from PostgreSQL for authorized viewer", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "repo-hw-prod",
              pull_request_number: 105,
              title: "Power Stage Production Review",
              status: "active",
              decision: "approved",
              base_run_id: null,
              head_run_id: "run-hw-105",
              current_revision_id: "rev_db_v1",
              created_by: "lead.eng@company.com",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "acme-hardware",
              name: "motor-inverter",
              private: true,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme-hardware",
            },
          ],
        };
      }

      if (norm.includes("from github_marketplace_subscriptions")) {
        return { rows: [] }; // Active / not canceled
      }

      if (norm.includes("from review_revisions where id = $1 and review_id = $2")) {
        return {
          rows: [
            {
              id: params[0],
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-hw-105",
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: "e".repeat(64),
            },
          ],
        };
      }

      if (norm.includes("from findings where run_id = $1")) {
        return {
          rows: [
            {
              id: "find_001",
              rule_id: "rule.clearance.high_voltage",
              severity: "error",
              message: "Creepage distance 1.8mm is less than required 2.5mm",
              path: "board.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_001",
            },
          ],
        };
      }

      if (norm.includes("from review_approvals")) {
        return {
          rows: [
            {
              id: "rapp_101",
              approver_id: "signoff.officer@company.com",
              status: "approved",
              reason: "Creepage and thermal vias verified.",
              is_break_glass: false,
              evidence_digest: "e".repeat(64),
              created_at: now,
            },
          ],
        };
      }

      if (norm.includes("from review_checklist_items")) {
        return {
          rows: [
            {
              id: "rchk_101",
              title: "DRC Report 0 Violations",
              completed: true,
              completed_by: "qa@company.com",
              completed_at: now,
            },
          ],
        };
      }

      if (norm.includes("from review_comments")) {
        return {
          rows: [
            {
              id: "rcmt_101",
              parent_id: null,
              author_id: "reviewer@company.com",
              author_type: "internal",
              content: "Looks good for tape-out.",
              status: "open",
              finding_fingerprint: null,
              evidence_anchor: null,
              created_at: now,
            },
          ],
        };
      }

      return { rows: [] };
    });

    const review = await loadServerReview(reviewId, authorizedSession);
    expect(review).toBeDefined();
    expect(review?.id).toBe(reviewId);
    expect(review?.decision).toBe("approved");
    expect(review?.currentRevisionId).toBe("rev_db_v1");
    expect(review?.findings).toHaveLength(1);
    expect(review?.findings[0]?.ruleId).toBe("rule.clearance.high_voltage");
    expect(review?.approvals).toHaveLength(1);
    expect(review?.approvals[0]?.approverId).toBe("signoff.officer@company.com");
  });

  it("populates headSnapshots from run_snapshots recorded for the revision's head run", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "repo-hw-prod",
              pull_request_number: 105,
              title: "Power Stage Production Review",
              status: "active",
              decision: "approved",
              base_run_id: null,
              head_run_id: "run-hw-105",
              current_revision_id: "rev_db_v1",
              created_by: "lead.eng@company.com",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "acme-hardware",
              name: "motor-inverter",
              private: true,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme-hardware",
            },
          ],
        };
      }

      if (norm.includes("from github_marketplace_subscriptions")) {
        return { rows: [] };
      }

      if (norm.includes("from review_revisions where id = $1 and review_id = $2")) {
        return {
          rows: [
            {
              id: "rev_db_v1",
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-hw-105",
              base_commit_sha: null,
              head_commit_sha: "1".repeat(40),
              evidence_digest: "e".repeat(64),
            },
          ],
        };
      }

      if (norm.includes("from run_snapshots")) {
        return {
          rows: [
            {
              snapshot_id: "snap_sch_board",
              name: "schematic_board.svg",
              kind: "schematic",
              format: "svg",
              sheet_or_layer: "board",
              width: 1200,
              height: 800,
              content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
              sha256: "f".repeat(64),
              anchors: [{ id: "anchor_comp_U1", kind: "component", targetRef: "U1", x: 0.1, y: 0.2 }],
            },
          ],
        };
      }

      return { rows: [] };
    });

    const review = await loadServerReview(reviewId, authorizedSession);
    expect(review?.headSnapshots).toHaveLength(1);
    expect(review?.headSnapshots?.[0]).toMatchObject({
      id: "snap_sch_board",
      kind: "schematic",
      sheetOrLayer: "board",
      content: '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    });
    expect(review?.headSnapshots?.[0]?.anchors).toHaveLength(1);
  });

  it("populates baseSnapshots by looking up a prior run recorded for the revision's base commit", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    const baseCommitSha = `${"0".repeat(39)}9`;

    mockLoaderQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "repo-hw-prod",
              pull_request_number: 105,
              title: "Power Stage Production Review",
              status: "active",
              decision: "approved",
              base_run_id: null,
              head_run_id: "run-hw-105",
              current_revision_id: "rev_db_v1",
              created_by: "lead.eng@company.com",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "acme-hardware",
              name: "motor-inverter",
              private: true,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme-hardware",
            },
          ],
        };
      }

      if (norm.includes("from github_marketplace_subscriptions")) {
        return { rows: [] };
      }

      if (norm.includes("from review_revisions where id = $1 and review_id = $2")) {
        return {
          rows: [
            {
              id: "rev_db_v1",
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-hw-105",
              base_commit_sha: baseCommitSha,
              head_commit_sha: "1".repeat(40),
              evidence_digest: "e".repeat(64),
            },
          ],
        };
      }

      if (norm.includes("from release_runs where repository_id = $1 and commit_sha = $2")) {
        expect(params).toEqual(["repo-hw-prod", baseCommitSha]);
        return { rows: [{ id: "run-hw-104-base" }] };
      }

      if (norm.includes("from run_snapshots where run_id = $1") && params[0] === "run-hw-104-base") {
        return {
          rows: [
            {
              snapshot_id: "snap_sch_board_base",
              name: "schematic_board.svg",
              kind: "schematic",
              format: "svg",
              sheet_or_layer: "board",
              width: 1200,
              height: 800,
              content: '<svg xmlns="http://www.w3.org/2000/svg"><g id="base"></g></svg>',
              sha256: "a".repeat(64),
              anchors: [],
            },
          ],
        };
      }

      if (norm.includes("from run_snapshots")) {
        return { rows: [] };
      }

      return { rows: [] };
    });

    const review = await loadServerReview(reviewId, authorizedSession);
    expect(review?.baseSnapshots).toHaveLength(1);
    expect(review?.baseSnapshots?.[0]).toMatchObject({ id: "snap_sch_board_base" });
  });

  it("fails closed (returns null) for unauthorized viewer on private repository", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockImplementation(async (sql: string) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              private: true,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme-hardware",
            },
          ],
        };
      }
      if (norm.includes("from github_marketplace_subscriptions")) {
        return { rows: [] };
      }
      return { rows: [] };
    });

    const unauthorizedSession: UserSession = {
      userId: 9999,
      login: "mallory",
      installationIds: [99999], // unauthorized installation
      issuedAt: now,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };

    const signedOutReview = await loadServerReview(reviewId, null);
    expect(signedOutReview).toBeNull();

    const unauthorizedReview = await loadServerReview(reviewId, unauthorizedSession);
    expect(unauthorizedReview).toBeNull();
  });

  it("fails closed when repository is disabled or installation is suspended", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockResolvedValueOnce({
      rows: [
        {
          id: reviewId,
          private: false,
          disabled_at: now, // disabled repository
          suspended_at: null,
          github_installation_id: 47001,
        },
      ],
    });

    expect(await loadServerReview(reviewId, authorizedSession)).toBeNull();
  });

  it("fails closed when Marketplace subscription is canceled", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery
      .mockResolvedValueOnce({
        rows: [
          {
            id: reviewId,
            private: false,
            disabled_at: null,
            suspended_at: null,
            github_installation_id: 47001,
            account_login: "acme-hardware",
          },
        ],
      })
      .mockResolvedValueOnce({
        rows: [{ 1: 1 }], // canceled subscription found
      });

    expect(await loadServerReview(reviewId, authorizedSession)).toBeNull();
  });

  it("selects the exact revision referenced by reviews.current_revision_id", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");
      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "repo-hw-prod",
              pull_request_number: 105,
              title: "Power Stage Review",
              status: "active",
              decision: "pending",
              base_run_id: null,
              head_run_id: "run-hw-v1",
              current_revision_id: "rev_specific_v1", // Explicit pointer to v1
              created_by: "lead@acme.com",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "acme",
              name: "power",
              private: false,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme",
            },
          ],
        };
      }

      if (norm.includes("from review_revisions")) {
        // Returns the exact requested revision id
        return {
          rows: [
            {
              id: (params[0] as string) ?? "rev_specific_v1",
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-hw-v1",
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: "a".repeat(64),
            },
          ],
        };
      }

      return { rows: [] };
    });

    const review = await loadServerReview(reviewId, authorizedSession);
    expect(review?.currentRevisionId).toBe("rev_specific_v1");
    expect(review?.currentRevisionSequence).toBe(1);
    expect(review?.evidenceDigest).toBe("a".repeat(64));
  });

  it("reconstructs finding collaboration state (disposition, reason, owner, assignees) and canonical severities", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockImplementation(async (sql: string, params: unknown[] = []) => {
      const norm = sql.toLowerCase().replace(/\s+/g, " ");

      if (norm.includes("from reviews join repositories")) {
        return {
          rows: [
            {
              id: reviewId,
              repository_id: "repo-hw-prod",
              pull_request_number: 105,
              title: "Power Stage Review",
              status: "active",
              decision: "pending",
              base_run_id: null,
              head_run_id: "run-hw-105",
              current_revision_id: "rev_db_v1",
              created_by: "lead.eng@company.com",
              created_at: now,
              updated_at: now,
              completed_at: null,
              owner: "acme",
              name: "power",
              private: false,
              disabled_at: null,
              suspended_at: null,
              github_installation_id: 47001,
              account_login: "acme",
            },
          ],
        };
      }

      if (norm.includes("from review_revisions where id = $1 and review_id = $2")) {
        return {
          rows: [
            {
              id: params[0],
              sequence: 1,
              base_run_id: null,
              head_run_id: "run-hw-105",
              base_commit_sha: "0".repeat(40),
              head_commit_sha: "1".repeat(40),
              evidence_digest: "e".repeat(64),
            },
          ],
        };
      }

      if (norm.includes("from findings where run_id = $1")) {
        return {
          rows: [
            {
              id: "f_err",
              rule_id: "rule.err",
              severity: "error",
              message: "Err",
              path: "b.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_err",
            },
            {
              id: "f_high",
              rule_id: "rule.high",
              severity: "high",
              message: "High",
              path: "b.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_high",
            },
            {
              id: "f_med",
              rule_id: "rule.med",
              severity: "medium",
              message: "Med",
              path: "b.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_med",
            },
            {
              id: "f_low",
              rule_id: "rule.low",
              severity: "low",
              message: "Low",
              path: "b.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_low",
            },
            {
              id: "f_info",
              rule_id: "rule.info",
              severity: "info",
              message: "Info",
              path: "b.kicad_pcb",
              kind: "drc",
              fingerprint: "fp_info",
            },
          ],
        };
      }

      if (norm.includes("from finding_decisions")) {
        return {
          rows: [
            {
              finding_fingerprint: "fp_err",
              disposition: "accepted_risk",
              reason: "Risk accepted per testing protocol in chamber 4.",
              owner: "safety.officer@company.com",
              expires_at: null,
            },
            {
              finding_fingerprint: "fp_high",
              disposition: "fixed",
              reason: "Trace clearance increased to 0.5mm in schematic sheet 2.",
              owner: "lead.hardware@company.com",
              expires_at: null,
            },
          ],
        };
      }

      if (norm.includes("from finding_assignments")) {
        return {
          rows: [
            { finding_fingerprint: "fp_err", assignee: "alice@company.com" },
            { finding_fingerprint: "fp_err", assignee: "bob@company.com" },
            { finding_fingerprint: "fp_med", assignee: "carol@company.com" },
          ],
        };
      }

      if (norm.includes("from artifacts")) {
        return {
          rows: [
            {
              id: "art_gerber_01",
              kind: "gerber",
              name: "gerbers.zip",
              role: "gerber",
              bytes: 409600,
              sha256: "c".repeat(64),
            },
          ],
        };
      }

      return { rows: [] };
    });

    const review = await loadServerReview(reviewId, authorizedSession);
    expect(review?.findings).toHaveLength(5);

    const fpErr = review?.findings.find((f) => f.fingerprint === "fp_err");
    expect(fpErr?.severity).toBe("error");
    expect(fpErr?.disposition).toBe("accepted_risk");
    expect(fpErr?.decisionReason).toBe("Risk accepted per testing protocol in chamber 4.");
    expect(fpErr?.decisionOwner).toBe("safety.officer@company.com");
    expect(fpErr?.assignees).toEqual(["alice@company.com", "bob@company.com"]);

    const fpHigh = review?.findings.find((f) => f.fingerprint === "fp_high");
    expect(fpHigh?.severity).toBe("error");
    expect(fpHigh?.disposition).toBe("fixed");
    expect(fpHigh?.decisionReason).toBe("Trace clearance increased to 0.5mm in schematic sheet 2.");

    const fpMed = review?.findings.find((f) => f.fingerprint === "fp_med");
    expect(fpMed?.severity).toBe("warning"); // Canonical: medium does not become blocker error!
    expect(fpMed?.assignees).toEqual(["carol@company.com"]);

    const fpLow = review?.findings.find((f) => f.fingerprint === "fp_low");
    expect(fpLow?.severity).toBe("info"); // Canonical: low does not become blocker error!

    const fpInfo = review?.findings.find((f) => f.fingerprint === "fp_info");
    expect(fpInfo?.severity).toBe("info");

    // Verify changedFiles and bomChanges are explicitly undefined when unpersisted (not fabricated from findings)
    expect(review?.changedFiles).toBeUndefined();
    expect(review?.bomChanges).toBeUndefined();

    // Verify evidenceItems populated from runner_artifacts
    expect(review?.evidenceItems).toHaveLength(1);
    expect(review?.evidenceItems[0]?.name).toBe("gerbers.zip");
    expect(review?.evidenceItems[0]?.type).toBe("pcb");
    expect(review?.evidenceItems[0]?.sha256).toBe("c".repeat(64));
  });

  it("does NOT fall back to demo fixtures when PostgreSQL review is missing", async () => {
    vi.spyOn(cloudConfig, "resolveCloudPersistenceConfiguration").mockReturnValue({
      mode: "postgres",
      databaseUrl: "postgresql://postgres:postgres@localhost:5432/boardreadyops",
    });

    mockLoaderQuery.mockResolvedValue({ rows: [] });

    // Unknown PostgreSQL review ID MUST return null
    const review = await loadServerReview("rev_real_db_missing_99", authorizedSession);
    expect(review).toBeNull();
  });
});
