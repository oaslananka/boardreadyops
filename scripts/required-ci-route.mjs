import path from "node:path";
import { pathToFileURL } from "node:url";

export function validateRequiredCiRoute({ check, classifierResult, needsWork, buildResult }) {
  if (classifierResult !== "success") {
    throw new Error(`${check}: CI risk classification did not succeed (${classifierResult || "missing"})`);
  }
  if (needsWork !== "true" && needsWork !== "false") {
    throw new Error(`${check}: invalid risk-profile decision (${needsWork || "missing"})`);
  }
  if (needsWork === "true" && check === "ci / verify-dist" && buildResult !== "success") {
    throw new Error(`${check}: upstream build must succeed (${buildResult || "missing"})`);
  }
  return needsWork === "true" ? "required" : "not-applicable";
}

function main() {
  const check = process.env.REQUIRED_CHECK;
  if (!check || !/^ci \/ (typecheck|test-unit|build|verify-dist|coverage-gate)$/u.test(check)) {
    throw new Error("Unknown required CI context");
  }
  const verdict = validateRequiredCiRoute({
    check,
    classifierResult: process.env.CLASSIFIER_RESULT,
    needsWork: process.env.NEEDS_WORK,
    buildResult: check === "ci / verify-dist" ? process.env.BUILD_RESULT : undefined,
  });
  if (verdict === "not-applicable") {
    process.stdout.write(
      `::notice::${check}: heavy validation not applicable to this changed-file risk profile; required routing executed successfully.\n`,
    );
  } else {
    process.stdout.write(`${check}: executing required validation for this change.\n`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main();
}
