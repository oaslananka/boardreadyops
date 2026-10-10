import fs from "node:fs/promises";
import path from "node:path";
import { verifyReviewedExportAttestation } from "../../release/export-attestation.js";
import { normalizePathInput } from "../../util/path.js";
import type { ExportChecksumsCliOptions } from "./export-checksums.js";

export interface ExportVerifyCliOptions extends ExportChecksumsCliOptions {
  repository: string;
  repositoryId: string;
  sourceRef: string;
  workflow: string;
  event: string;
  runId: string;
  runAttempt: string;
  bundle?: string | undefined;
}

/** Caller is responsible for obtaining expectations from a separately
 * authorized target-repository installation and reviewed run. Inputs are never
 * sourced from the manifest and eligible is not a release or GA verdict.
 */
export async function exportVerifyCommand(
  pathInput: string,
  options: ExportVerifyCliOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  try {
    const root = await fs.realpath(path.resolve(normalizePathInput(pathInput)));
    const attempt = Number(options.runAttempt);
    const result = await verifyReviewedExportAttestation({
      root,
      manifestPath: normalizePathInput(options.manifest),
      expected: {
        repository: options.repository,
        repositoryId: options.repositoryId,
        reviewedSha: options.reviewedSourceSha,
        sourceRef: options.sourceRef,
        workflowPath: options.workflow,
        event: options.event,
        runId: options.runId,
        runAttempt: attempt,
      },
      ...(options.bundle ? { bundlePath: normalizePathInput(options.bundle) } : {}),
    });
    streams.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "eligible" ? 0 : 1;
  } catch {
    streams.stderr.write("Export signature verification failed closed. No trusted provenance established.\n");
    return 2;
  }
}
