import {
  type ReviewDecision,
  type ReviewStatus,
  reviewDecisionSchema,
  reviewStatusSchema,
} from "@boardreadyops/contracts";
import { pcbFootprintSummarySchema } from "@boardreadyops/contracts/pcb-footprint-summary";

/** Canonical OAuth resource identifier: never derive this from untrusted Host/Forwarded headers. */
export const remoteMcpResource = "https://boardreadyops.com/mcp";
export const remoteMcpMetadataUrl = "https://boardreadyops.com/.well-known/oauth-protected-resource/mcp";

/** These scopes are reserved for a future user-bound OAuth grant; API tokens are not accepted. */
const remoteMcpScopes = ["review:read", "evidence:read"] as const;

/**
 * No hosted MCP operation is enabled until real OAuth token validation and per-request
 * tenant/repository authorization are wired. This includes callers with web cookies,
 * legacy API tokens and manually constructed Bearer headers.
 */
export function unavailableRemoteMcpResponse(): Response {
  return Response.json(
    { error: "remote_mcp_not_available", message: "Remote MCP authorization is not enabled" },
    { status: 503, headers: { "cache-control": "no-store", "retry-after": "3600" } },
  );
}

/**
 * RFC 9728 metadata builder, intentionally NOT published until OAuth is operational.
 * The issuer comes from trusted deployment configuration, never from a request header.
 */
export function protectedResourceMetadata(issuer: string): {
  resource: string;
  authorization_servers: string[];
  scopes_supported: string[];
  bearer_methods_supported: string[];
} {
  const url = new URL(issuer);
  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.toString() !== issuer && url.toString() !== `${issuer}/`) ||
    /[\r\n"]/.test(issuer)
  ) {
    throw new Error("Invalid remote MCP OAuth issuer");
  }
  return {
    resource: remoteMcpResource,
    authorization_servers: [issuer],
    scopes_supported: [...remoteMcpScopes],
    bearer_methods_supported: ["header"],
  };
}

/**
 * An allowlisted export contract for *already authorized* Review data. Never pass raw
 * database rows through an MCP tool. No title, paths, BOM, coordinates, CAD content,
 * raw finding messages, or manufacturing/risk verdict are exported.
 */
export function remoteReviewFacts(input: {
  status: ReviewStatus;
  decision: ReviewDecision;
  evidenceDigest?: string;
  headCommitSha?: string;
}): {
  schemaVersion: 1;
  status: ReviewStatus;
  decision: ReviewDecision;
  evidenceDigest?: string;
  headCommitSha?: string;
  productionApproval: "not-evaluated";
} {
  const digest = input.evidenceDigest;
  const commit = input.headCommitSha;
  if (digest !== undefined && !/^[0-9a-f]{64}$/.test(digest)) throw new Error("Invalid evidence digest");
  if (commit !== undefined && !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(commit)) {
    throw new Error("Invalid head commit SHA");
  }
  return {
    schemaVersion: 1,
    status: reviewStatusSchema.parse(input.status),
    decision: reviewDecisionSchema.parse(input.decision),
    ...(digest ? { evidenceDigest: digest } : {}),
    ...(commit ? { headCommitSha: commit } : {}),
    productionApproval: "not-evaluated",
  };
}

/** Source-bound but client-reported PCB counts only. "Missing" is not a zero-change assertion. */
export function remoteFootprintFacts(
  input: unknown,
):
  | { availability: "unavailable"; riskAssessment: "not-evaluated" }
  | { availability: "client-reported"; summary: ReturnType<typeof pcbFootprintSummarySchema.parse> } {
  if (input === null || input === undefined) {
    return { availability: "unavailable", riskAssessment: "not-evaluated" };
  }
  const validated = pcbFootprintSummarySchema.parse(input);
  return { availability: "client-reported", summary: validated };
}
