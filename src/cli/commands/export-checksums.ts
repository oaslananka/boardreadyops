import fs from "node:fs/promises";
import path from "node:path";
import { prepareExportAttestationChecksums } from "../../release/export-attestation.js";
import { normalizePathInput } from "../../util/path.js";

export interface ExportChecksumsCliOptions {
  manifest: string;
  reviewedSourceSha: string;
}

/**
 * The resulting text is suitable for actions/attest subject-checksums,
 * but is not signed and MUST NOT be elevated to independent evidence.
 */
export async function exportChecksumsCommand(
  pathInput: string,
  options: ExportChecksumsCliOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  try {
    const root = await fs.realpath(path.resolve(normalizePathInput(pathInput)));
    const checksums = await prepareExportAttestationChecksums({
      root,
      manifestPath: normalizePathInput(options.manifest),
      reviewedSha: options.reviewedSourceSha,
    });
    streams.stdout.write(checksums);
    return 0;
  } catch {
    streams.stderr.write("Reviewed export source/output inventory failed closed. No attestation subjects emitted.\n");
    return 2;
  }
}
