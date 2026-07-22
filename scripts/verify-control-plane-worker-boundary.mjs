import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const forbiddenInputPatterns = [
  /(?:^|\/)src\/kicad\//u,
  /(?:^|\/)src\/runner\/(?:job-)?executor(?:\.|\/)/u,
  /(?:^|\/)src\/repository-checkout(?:\.|\/)/u,
  /(?:^|\/)src\/source-workspace(?:\.|\/)/u,
  /(?:^|\/)packages\/core\/.*(?:checkout|executor|kicad|workspace)/u,
];
const forbiddenImports = new Set(["child_process", "node:child_process"]);

function normalizedPath(value) {
  return String(value).replaceAll("\\", "/");
}

export function findControlPlaneWorkerBoundaryViolations(metafile) {
  const violations = new Set();
  const inputs = metafile && typeof metafile === "object" && metafile.inputs ? Object.keys(metafile.inputs) : [];

  for (const input of inputs) {
    const normalized = normalizedPath(input);
    if (forbiddenInputPatterns.some((pattern) => pattern.test(normalized))) violations.add(input);
  }

  const outputs = metafile && typeof metafile === "object" && metafile.outputs ? Object.values(metafile.outputs) : [];
  for (const output of outputs) {
    const imports = output && typeof output === "object" && Array.isArray(output.imports) ? output.imports : [];
    for (const imported of imports) {
      const path = imported && typeof imported === "object" ? imported.path : undefined;
      if (typeof path === "string" && forbiddenImports.has(path)) violations.add(path);
    }
  }

  return [...violations].sort((left, right) => left.localeCompare(right));
}

export function verifyControlPlaneWorkerBoundary(metafile) {
  const violations = findControlPlaneWorkerBoundaryViolations(metafile);
  if (violations.length > 0) {
    throw new Error(`Control-plane worker bundle crossed the execution boundary: ${violations.join(", ")}`);
  }
}

async function main() {
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const metadataPath = process.argv[2] ? join(process.cwd(), process.argv[2]) : join(root, "apps/web/.next/worker-meta.json");
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  verifyControlPlaneWorkerBoundary(metadata);
  process.stdout.write(`${JSON.stringify({ event: "worker.boundary_verified", metadataPath })}\n`);
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(
      `${JSON.stringify({
        event: "worker.boundary_failed",
        errorClass: error instanceof Error ? error.name : "UnknownError",
        message: error instanceof Error ? error.message.slice(0, 1_000) : "Worker boundary verification failed.",
      })}\n`,
    );
    process.exitCode = 1;
  });
}
