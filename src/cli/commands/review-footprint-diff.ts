import { gitPcbFootprintEvidence } from "../../kicad/git-footprint-evidence.js";

export interface ReviewFootprintDiffOptions {
  base: string;
  head: string;
  pcb: string;
  format?: string;
}

/** Offline, source-only fact extraction; never invokes review publication or network calls. */
export function reviewFootprintDiffCommand(
  target: string | undefined,
  options: ReviewFootprintDiffOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  if (options.format && options.format !== "text" && options.format !== "json") {
    streams.stderr.write("Invalid format: choose text or json.\n");
    return 2;
  }
  const result = gitPcbFootprintEvidence({
    repositoryRoot: target ?? process.cwd(),
    baseRef: options.base,
    headRef: options.head,
    sourcePath: options.pcb,
  });
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
