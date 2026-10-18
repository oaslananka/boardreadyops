#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const exactGitShaPattern = /^[0-9a-f]{40}$/u;

function requiredCount(input, key, expected, label) {
  const value = input[key];
  if (!Number.isSafeInteger(value) || value !== expected) {
    throw new Error(`${label} must equal ${expected}`);
  }
  return value;
}

export function validateTargetRepositoryIsolationEvidence(input) {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("target-repository isolation evidence must be an object");
  }
  if (!exactGitShaPattern.test(input.sourceSha ?? "")) {
    throw new Error("sourceSha must be an exact 40-character lowercase Git SHA");
  }

  return {
    sourceSha: input.sourceSha,
    independentCallbacksAccepted: requiredCount(input, "independentCallbacksAccepted", 2, "independent callbacks"),
    independentCheckRunsPublished: requiredCount(input, "independentCheckRunsPublished", 2, "independent Check Runs"),
    crossInstallationCallbacksRejected: requiredCount(
      input,
      "crossInstallationCallbacksRejected",
      2,
      "cross-installation callbacks",
    ),
    staleAttemptCallbacksRejected: requiredCount(input, "staleAttemptCallbacksRejected", 1, "stale-attempt callbacks"),
    exactSignedJwtReplaysAccepted: requiredCount(input, "exactSignedJwtReplaysAccepted", 1, "exact signed JWT replays"),
    persistedSupersededAttemptRacesRejected: requiredCount(
      input,
      "persistedSupersededAttemptRacesRejected",
      1,
      "persisted superseded attempt races",
    ),
    claimMutationCallbacksRejected: requiredCount(
      input,
      "claimMutationCallbacksRejected",
      7,
      "claim-mutation callbacks",
    ),
    trustSnapshotCallbacksRejected: requiredCount(
      input,
      "trustSnapshotCallbacksRejected",
      2,
      "trust-snapshot callbacks",
    ),
    rejectedCallbackMutations: requiredCount(input, "rejectedCallbackMutations", 0, "rejected callback mutations"),
    rejectedCallbackPublications: requiredCount(
      input,
      "rejectedCallbackPublications",
      0,
      "rejected callback publications",
    ),
    optionalCommentWarnings: requiredCount(input, "optionalCommentWarnings", 1, "optional comment warnings"),
    responseLeakageFindings: requiredCount(input, "responseLeakageFindings", 0, "response leakage findings"),
  };
}

export function buildTargetRepositoryIsolationReport(input) {
  const evidence = validateTargetRepositoryIsolationEvidence(input);
  return {
    event: "target_repository_two_installation_isolation_verified",
    sourceSha: evidence.sourceSha,
    // This exercises two synthetic database fixtures, not two real GitHub App
    // owners. Never permit aggregate counts to imply live tenant acceptance.
    proof: {
      kind: "synthetic-database-adversarial",
      liveTwoOwnerAcceptance: false,
      architecture: "ADR-0010",
      milestone: "Cloud Control Plane Reliability",
    },
    topology: {
      installations: 2,
      repositories: 2,
      runs: 2,
      executionAttempts: 3,
    },
    accepted: {
      independentCallbacks: evidence.independentCallbacksAccepted,
      independentCheckRuns: evidence.independentCheckRunsPublished,
      exactSignedJwtReplays: evidence.exactSignedJwtReplaysAccepted,
    },
    rejected: {
      crossInstallationCallbacks: evidence.crossInstallationCallbacksRejected,
      staleAttemptCallbacks: evidence.staleAttemptCallbacksRejected,
      persistedSupersededAttemptRaces: evidence.persistedSupersededAttemptRacesRejected,
      claimMutationCallbacks: evidence.claimMutationCallbacksRejected,
      trustSnapshotCallbacks: evidence.trustSnapshotCallbacksRejected,
    },
    invariants: {
      rejectedCallbackMutations: evidence.rejectedCallbackMutations,
      rejectedCallbackPublications: evidence.rejectedCallbackPublications,
      optionalCommentWarnings: evidence.optionalCommentWarnings,
      responseLeakageFindings: evidence.responseLeakageFindings,
    },
  };
}

export async function writeTargetRepositoryIsolationReport(inputPath, outputPath) {
  const evidence = JSON.parse(await fs.readFile(inputPath, "utf8"));
  const report = buildTargetRepositoryIsolationReport(evidence);
  await fs.mkdir(path.dirname(path.resolve(outputPath)), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await fs.chmod(outputPath, 0o600);
  return report;
}

async function main(environment = process.env) {
  const inputPath = environment.BOARDREADYOPS_ISOLATION_EVIDENCE_PATH;
  const outputPath = environment.BOARDREADYOPS_ISOLATION_REPORT_PATH;
  if (!inputPath || !outputPath) {
    throw new Error("BOARDREADYOPS_ISOLATION_EVIDENCE_PATH and BOARDREADYOPS_ISOLATION_REPORT_PATH are required");
  }
  const report = await writeTargetRepositoryIsolationReport(inputPath, outputPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  await main();
}
