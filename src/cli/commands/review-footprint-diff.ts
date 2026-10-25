import { pcbFootprintSummarySchema } from "@boardreadyops/contracts/pcb-footprint-summary";
import { type GitPcbEvidenceResult, gitPcbFootprintEvidence } from "../../kicad/git-footprint-evidence.js";

export interface ReviewFootprintDiffOptions {
  base: string;
  head: string;
  pcb: string;
  format?: string;
}

export function summaryFromVerifiedFacts(evidence: Extract<GitPcbEvidenceResult, { status: "complete" }>) {
  const countFields = { reference: 0, libraryId: 0, layer: 0, positionMm: 0, rotationDeg: 0 };
  let added = 0;
  let removed = 0;
  let modified = 0;
  for (const fact of evidence.facts.changes) {
    if (fact.status === "footprint-added") added++;
    else if (fact.status === "footprint-removed") removed++;
    else {
      modified++;
      for (const field of fact.changedFields) countFields[field]++;
    }
  }
  return pcbFootprintSummarySchema.parse({
    schemaVersion: 1,
    scope: "pcb-footprints-only",
    provenance: "local-git-commits",
    disclosure: "counts-and-digests-only",
    baseCommitSha: evidence.baseCommitSha,
    headCommitSha: evidence.headCommitSha,
    baseBlobSha: evidence.baseBlobSha,
    headBlobSha: evidence.headBlobSha,
    baseSourceSha256: evidence.facts.baseSourceSha256,
    headSourceSha256: evidence.facts.headSourceSha256,
    changes: { added, removed, modified, byField: countFields },
    riskAssessment: "not-evaluated",
  });
}

/** Offline, source-only fact extraction; never invokes review publication or network calls. */
export function reviewFootprintDiffCommand(
  target: string | undefined,
  options: ReviewFootprintDiffOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  if (options.format && options.format !== "text" && options.format !== "json" && options.format !== "summary-json") {
    streams.stderr.write("Invalid format: choose text, json or summary-json.\n");
    return 2;
  }
  const result = gitPcbFootprintEvidence({
    repositoryRoot: target ?? process.cwd(),
    baseRef: options.base,
    headRef: options.head,
    sourcePath: options.pcb,
  });
  if (options.format === "summary-json") {
    if (result.status !== "complete") {
      streams.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
      return 1;
    }
    streams.stdout.write(`${JSON.stringify(summaryFromVerifiedFacts(result), null, 2)}\n`);
    return 0;
  }
  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify({ schemaVersion: 1, ...result }, null, 2)}\n`);
    return result.status === "complete" ? 0 : 1;
  }
  if (result.status === "unavailable") {
    streams.stderr.write(`PCB source comparison unavailable: ${result.reason}. No change verdict was computed.\n`);
    return 1;
  }
  const added = result.facts.changes.filter((change) => change.status === "footprint-added").length;
  const removed = result.facts.changes.filter((change) => change.status === "footprint-removed").length;
  const modified = result.facts.changes.filter((change) => change.status === "footprint-modified").length;
  streams.stdout.write(
    `Verified Git PCB footprint facts: ${result.sourcePath}\n` +
      `Base: ${result.baseCommitSha} (${result.facts.baseSourceSha256})\n` +
      `Head: ${result.headCommitSha} (${result.facts.headSourceSha256})\n` +
      `Footprints: ${added} added, ${removed} removed, ${modified} modified.\n` +
      `Risk/policy/DRC assessment: not evaluated. Other PCB objects are not covered.\n` +
      `Local-only comparison: no source files or results were uploaded.\n`,
  );
  return 0;
}
