import { readFile } from "node:fs/promises";

const packageJson = JSON.parse(await readFile("package.json", "utf8"));
const manifest = JSON.parse(await readFile(".release-please-manifest.json", "utf8"));
const generated = await readFile("src/generated/version.ts", "utf8");
const generatedVersion = /boardReadyVersion\s*=\s*"([^"]+)"/.exec(generated)?.[1];
const versions = [packageJson.version, manifest["."], generatedVersion];

if (versions.some((version) => version !== packageJson.version)) {
  throw new Error(
    `version mismatch: package=${packageJson.version} manifest=${manifest["."]} generated=${generatedVersion}`,
  );
}

// Check that any explicit version pin in the README matches the package version.
// Lines of the form `boardreadyops@X.Y.Z` or `npm i -g boardreadyops` followed by
// a version statement are checked. Soft: README may reference older stable pins for
// installation examples, so only the explicit "current public npm package" statement
// is enforced (reduces false positives on pinned Action examples).
const readme = await readFile("README.md", "utf8");
const readmeVersionMatch = /The current public npm package is `boardreadyops@([\d.]+)`/.exec(readme);
if (readmeVersionMatch) {
  const readmeVersion = readmeVersionMatch[1];
  if (readmeVersion !== packageJson.version) {
    throw new Error(
      `README version pin mismatch: README says ${readmeVersion} but package.json is ${packageJson.version}. Update the "current public npm package" line in README.md.`,
    );
  }
}

if (!process.env.ALLOW_MAJOR_RELEASE && isMajorRelease(packageJson.version)) {
  throw new Error("version 2.0.0 or later requires ALLOW_MAJOR_RELEASE=true");
}

function isMajorRelease(version) {
  const major = Number(/^(\d+)\./.exec(version)?.[1] ?? "0");
  return major >= 2;
}
