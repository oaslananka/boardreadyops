import path from "node:path";
import { loadConfig } from "../../core/config.js";
import { canonicalRoot, runPipeline } from "../../core/pipeline.js";
import {
  evaluatePolicy,
  formatPolicyText,
  type PolicyInput,
  type SourceBoundPolicyEvidence,
} from "../../core/policy.js";
import { verifyExportProvenance } from "../../core/provenance.js";
import { verifyReviewedExportAttestation } from "../../release/export-attestation.js";
import { normalizePathInput } from "../../util/path.js";
import { type CommonCliOptions, pipelineInputFromCli } from "./run.js";
import type { ExportVerifyCliOptions } from "./verify-export-attestation.js";

export interface PolicyCommandOptions extends CommonCliOptions, Partial<ExportVerifyCliOptions> {
  simulate?: boolean;
}

/** The expected signer/run values MUST come from an independently authorized
 * provider/run record, NEVER the unsigned manifest or a callback body.
 */
async function sourceBoundEvidence(root: string, options: PolicyCommandOptions): Promise<SourceBoundPolicyEvidence> {
  const manifest = options.manifest;
  if (!manifest) return { status: "unverified", reason: "No manufacturing export manifest supplied." };
  if (
    options.repository &&
    options.repositoryId &&
    options.reviewedSourceSha &&
    options.sourceRef &&
    options.workflow &&
    options.event &&
    options.runId &&
    options.runAttempt
  ) {
    try {
      const verified = await verifyReviewedExportAttestation({
        root,
        manifestPath: manifest,
        expected: {
          repository: options.repository,
          repositoryId: options.repositoryId,
          reviewedSha: options.reviewedSourceSha,
          sourceRef: options.sourceRef,
          workflowPath: options.workflow,
          event: options.event,
          runId: options.runId,
          runAttempt: Number(options.runAttempt),
        },
        ...(options.bundle ? { bundlePath: options.bundle } : {}),
      });
      if (verified.status === "eligible" && verified.sourceSha && verified.runInvocationURI && verified.subjects) {
        return {
          status: "source-bound-verified",
          reason: verified.reason,
          sourceSha: verified.sourceSha,
          runInvocationURI: verified.runInvocationURI,
          subjects: verified.subjects,
        };
      }
    } catch {
      // Unsupported and unavailable cryptographic verifiers never establish trusted identity.
    }
  }
  try {
    const local = await verifyExportProvenance(root, manifest, {
      ...(options.reviewedSourceSha ? { currentGitSha: options.reviewedSourceSha } : {}),
    });
    if (local.status === "verified") {
      return {
        status: "byte-consistent-only",
        reason: "Local output bytes match their self-reported manifest; signed execution not authenticated.",
      };
    }
  } catch {
    // Missing, changed or unsafe local paths remain unverified.
  }
  return { status: "unverified", reason: "No independently verified source-to-export evidence is available." };
}

export async function policyCommand(
  pathInput: string | undefined,
  options: PolicyCommandOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const result = await runPipeline(pipelineInputFromCli(root, options, false));
  let policy = result.policy;
  if (policy?.rules.some((rule) => rule.type === "require-source-bound-export")) {
    const loaded = await loadConfig(root, options.config);
    if (loaded.errors.length > 0 || !loaded.config.policy) {
      streams.stderr.write("Strict source-bound policy configuration could not be loaded.\n");
      return 2;
    }
    const sourceBound = await sourceBoundEvidence(root, options);
    const input: PolicyInput = {
      summary: result.summary,
      ruleIds: [...new Set(result.findings.map((finding) => finding.ruleId))],
      readiness: result.readiness,
      expiredWaivers: result.waivers?.expired.length ?? 0,
      staleWaivers: result.waivers?.active.filter((waiver) => waiver.stale).length ?? 0,
      sourceBound,
    };
    policy = evaluatePolicy(loaded.config.policy, input);
  }

  if (!policy) {
    if (options.format === "json") {
      streams.stdout.write(`${JSON.stringify({ status: "skipped", reason: "no policy configured" }, null, 2)}\n`);
    } else {
      streams.stdout.write("No policy configured; nothing to evaluate.\n");
    }
    return 0;
  }

  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(policy, null, 2)}\n`);
  } else {
    streams.stdout.write(formatPolicyText(policy));
  }

  if (options.simulate) {
    return 0;
  }
  return policy.enforced && policy.status === "fail" ? 1 : 0;
}
