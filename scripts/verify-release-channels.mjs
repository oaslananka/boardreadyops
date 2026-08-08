import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const EXPECTED_BINARY_ASSETS = [
  "boardreadyops-linux-x64",
  "boardreadyops-linux-arm64",
  "boardreadyops-macos-x64",
  "boardreadyops-macos-arm64",
  "boardreadyops-win-x64.exe",
];
const EXPECTED_RELEASE_ASSETS = [...EXPECTED_BINARY_ASSETS, "SHA256SUMS", "sbom.cyclonedx.json"];
const FORMULA_BINARY_ASSETS = [
  "boardreadyops-linux-x64",
  "boardreadyops-linux-arm64",
  "boardreadyops-macos-x64",
  "boardreadyops-macos-arm64",
];
const ACTION_REFERENCE_FILES = [
  "README.md",
  "docs/action.md",
  "docs/github-action.md",
  "docs/integrations/kibot.md",
  "docs/sbom.md",
  "docs/review-app.md",
];

export function evaluatePublicReleaseSnapshot(snapshot) {
  const failures = [];
  const fail = (name, passed, details) => {
    if (!passed) failures.push({ name, details });
  };
  const tag = `v${snapshot.version}`;

  fail("public npm package matches package.json version", snapshot.npm?.version === snapshot.version, {
    expected: snapshot.version,
    actual: snapshot.npm?.version,
  });
  fail("npm latest dist-tag matches package.json version", snapshot.npm?.latest === snapshot.version, {
    expected: snapshot.version,
    actual: snapshot.npm?.latest,
  });
  fail("public npm engines match package.json", snapshot.npm?.engines === snapshot.expectedNodeEngines, {
    expected: snapshot.expectedNodeEngines,
    actual: snapshot.npm?.engines,
  });
  fail(
    "latest GitHub release matches package.json version",
    snapshot.release?.tag === tag && snapshot.release?.draft === false && snapshot.release?.prerelease === false,
    { expected: tag, actual: snapshot.release?.tag },
  );
  fail("floating v1 tag matches the exact release commit", snapshot.floatingV1Commit === snapshot.release?.commit, {
    exact: snapshot.release?.commit,
    floating: snapshot.floatingV1Commit,
  });

  const assets = new Map((snapshot.release?.assets ?? []).map((asset) => [asset.name, asset]));
  const compareAssetNames = (left, right) => left.localeCompare(right, "en");
  const assetNames = [...assets.keys()].sort(compareAssetNames);
  const expectedAssetNames = [...EXPECTED_RELEASE_ASSETS].sort(compareAssetNames);
  fail(
    "GitHub release exposes the expected binary, checksum, and SBOM assets",
    JSON.stringify(assetNames) === JSON.stringify(expectedAssetNames),
    { expected: expectedAssetNames, actual: assetNames },
  );

  const checksumMatches = EXPECTED_BINARY_ASSETS.every((name) => {
    const assetDigest = normalizeSha256(assets.get(name)?.digest);
    return Boolean(assetDigest) && snapshot.checksumEntries?.[name] === assetDigest;
  });
  fail("release binary checksums match GitHub asset digests", checksumMatches, {
    checksumEntries: snapshot.checksumEntries,
  });

  const metadataFilesMatch = ["SHA256SUMS", "sbom.cyclonedx.json"].every((name) => {
    const assetDigest = normalizeSha256(assets.get(name)?.digest);
    return Boolean(assetDigest) && snapshot.downloadedAssetDigests?.[name] === assetDigest;
  });
  fail("downloaded checksum and SBOM files match GitHub asset digests", metadataFilesMatch, {
    downloadedAssetDigests: snapshot.downloadedAssetDigests,
  });

  const exactDigest = snapshot.ghcr?.exact?.digest;
  const aliasesMatch =
    Boolean(exactDigest) &&
    snapshot.ghcr?.major?.digest === exactDigest &&
    snapshot.ghcr?.latest?.digest === exactDigest;
  fail("GHCR stable aliases resolve to the exact release index", aliasesMatch, snapshot.ghcr);
  const requiredPlatforms = ["linux/amd64", "linux/arm64"];
  const platformsMatch = [snapshot.ghcr?.exact, snapshot.ghcr?.major, snapshot.ghcr?.latest].every((manifest) =>
    requiredPlatforms.every((platform) => manifest?.platforms?.includes(platform)),
  );
  fail("GHCR release indexes include linux/amd64 and linux/arm64", platformsMatch, snapshot.ghcr);

  const actionPins = snapshot.actionPins ?? [];
  const actionPinsMatch =
    actionPins.length >= ACTION_REFERENCE_FILES.length &&
    actionPins.every((pin) => pin.sha === snapshot.release?.commit && pin.version === snapshot.version);
  fail("recommended immutable Action pins match the reviewed release commit", actionPinsMatch, {
    expectedCommit: snapshot.release?.commit,
    expectedVersion: snapshot.version,
    actionPins,
  });
  fail(
    "reviewed release Action metadata matches the current Action contract",
    snapshot.actionMetadataMatchesRelease === true,
  );

  const expectedFormulaDigests = FORMULA_BINARY_ASSETS.map((name) => snapshot.checksumEntries?.[name]).filter(Boolean);
  const formulaDigests = new Set(snapshot.formula?.digests ?? []);
  fail(
    "repository Homebrew formula matches the current release checksums",
    snapshot.formula?.version === snapshot.version &&
      expectedFormulaDigests.length === FORMULA_BINARY_ASSETS.length &&
      expectedFormulaDigests.every((digest) => formulaDigests.has(digest)),
    { expectedVersion: snapshot.version, formula: snapshot.formula },
  );

  return failures;
}

export async function runReleaseChannelChecks({
  root = process.cwd(),
  env = process.env,
  fetchImpl = globalThis.fetch,
} = {}) {
  const checks = [];
  const failures = [];
  const check = (name, passed, details) => {
    checks.push(name);
    if (!passed) failures.push({ name, details });
  };

  const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  const manifest = JSON.parse(await readFile(join(root, ".release-please-manifest.json"), "utf8"));
  const generated = await readFile(join(root, "src/generated/version.ts"), "utf8");
  const releasePlease = JSON.parse(await readFile(join(root, "release-please-config.json"), "utf8"));
  const publishWorkflow = await readFile(join(root, ".github/workflows/publish-npm.yml"), "utf8");

  const version = packageJson.version;
  const generatedVersion = /boardReadyVersion\s*=\s*"([^"]+)"/.exec(generated)?.[1];

  check("package.json version matches .release-please-manifest.json", manifest["."] === version, {
    package: version,
    manifest: manifest["."],
  });
  check("package.json version matches src/generated/version.ts", generatedVersion === version, {
    package: version,
    generated: generatedVersion,
  });
  check(
    "package publishConfig enables public provenance publishing",
    packageJson.publishConfig?.access === "public" && packageJson.publishConfig?.provenance === true,
    { publishConfig: packageJson.publishConfig },
  );

  const extraFiles = releasePlease.packages?.["."]?.["extra-files"] ?? [];
  check(
    "release-please updates src/generated/version.ts",
    extraFiles.some((entry) => entry?.path === "src/generated/version.ts"),
    { extraFiles },
  );
  check("npm publish workflow can mint OIDC tokens", /\bid-token:\s*write\b/.test(publishWorkflow));
  check(
    "npm publish workflow refuses long-lived token authentication fallback",
    /Refuse npm token-auth fallback/.test(publishWorkflow) &&
      !/secrets\.NPM_TOKEN/.test(publishWorkflow) &&
      !/_authToken=/.test(publishWorkflow),
  );
  check(
    "npm publish workflow disables package-manager cache for release builds",
    /package-manager-cache:\s*false/.test(publishWorkflow),
  );
  check(
    "npm publish workflow publishes with npm provenance",
    /npm publish[^\n]*--provenance/.test(publishWorkflow) ||
      (packageJson.publishConfig?.provenance === true && /id-token:\s*write/.test(publishWorkflow)),
  );
  check(
    "npm publish workflow verifies package version against the release tag",
    /v\$\{package_version\}/.test(publishWorkflow) && /RELEASE_TAG/.test(publishWorkflow),
  );
  check("npm publish workflow attests built artifacts", /actions\/attest-build-provenance@/.test(publishWorkflow));
  check(
    "npm publish workflow uploads an SBOM artifact",
    /name:\s*sbom/.test(publishWorkflow) && /sbom\.cyclonedx\.json/.test(publishWorkflow),
  );

  if (env.BOARDREADY_VERIFY_PUBLIC_CHANNELS === "1") {
    try {
      const snapshot = await collectPublicReleaseSnapshot({
        version,
        expectedNodeEngines: packageJson.engines?.node,
        root,
        fetchImpl,
        githubToken: env.GITHUB_TOKEN,
      });
      for (const failure of evaluatePublicReleaseSnapshot(snapshot)) failures.push(failure);
      for (const name of [
        "public npm package matches package.json version",
        "npm latest dist-tag matches package.json version",
        "public npm engines match package.json",
        "latest GitHub release matches package.json version",
        "floating v1 tag matches the exact release commit",
        "GitHub release exposes the expected binary, checksum, and SBOM assets",
        "release binary checksums match GitHub asset digests",
        "downloaded checksum and SBOM files match GitHub asset digests",
        "GHCR stable aliases resolve to the exact release index",
        "GHCR release indexes include linux/amd64 and linux/arm64",
        "recommended immutable Action pins match the reviewed release commit",
        "reviewed release Action metadata matches the current Action contract",
        "repository Homebrew formula matches the current release checksums",
      ]) {
        checks.push(name);
      }
    } catch (error) {
      failures.push({
        name: "public release channels can be read and verified",
        details: { error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  return { checks, failures };
}

async function collectPublicReleaseSnapshot({ version, expectedNodeEngines, root, fetchImpl, githubToken }) {
  const tag = `v${version}`;
  const npmPackage = await fetchJson(`https://registry.npmjs.org/boardreadyops/${version}`, fetchImpl);
  const npmTags = await fetchJson("https://registry.npmjs.org/-/package/boardreadyops/dist-tags", fetchImpl);
  const githubHeaders = githubApiHeaders(githubToken);
  const release = await fetchJson(
    "https://api.github.com/repos/oaslananka/boardreadyops/releases/latest",
    fetchImpl,
    githubHeaders,
  );
  const exactCommit = await resolveGitHubTagCommit(tag, fetchImpl, githubHeaders);
  const floatingV1Commit = await resolveGitHubTagCommit("v1", fetchImpl, githubHeaders);

  const assets = (release.assets ?? []).map((asset) => ({
    name: asset.name,
    digest: asset.digest,
    downloadUrl: asset.browser_download_url,
  }));
  const assetByName = new Map(assets.map((asset) => [asset.name, asset]));
  const checksumAsset = assetByName.get("SHA256SUMS");
  const sbomAsset = assetByName.get("sbom.cyclonedx.json");
  if (!checksumAsset?.downloadUrl || !sbomAsset?.downloadUrl) {
    throw new Error("latest release is missing SHA256SUMS or sbom.cyclonedx.json download URLs");
  }
  const checksumBytes = await fetchBytes(checksumAsset.downloadUrl, fetchImpl);
  const sbomBytes = await fetchBytes(sbomAsset.downloadUrl, fetchImpl);
  const checksumText = new TextDecoder().decode(checksumBytes);

  const ghcr = {
    exact: await fetchGhcrManifest(tag, fetchImpl),
    major: await fetchGhcrManifest("v1", fetchImpl),
    latest: await fetchGhcrManifest("latest", fetchImpl),
  };

  const actionPins = [];
  for (const path of ACTION_REFERENCE_FILES) {
    const content = await readFile(join(root, path), "utf8");
    for (const match of content.matchAll(
      /oaslananka\/boardreadyops(?:\/apps\/container)?@([0-9a-f]{40})\s+#\s+v([0-9]+\.[0-9]+\.[0-9]+)/g,
    )) {
      actionPins.push({ path, sha: match[1], version: match[2] });
    }
  }

  const localRootAction = await readFile(join(root, "action.yml"), "utf8");
  const localContainerAction = await readFile(join(root, "apps/container/action.yml"), "utf8");
  const [releaseRootAction, releaseContainerAction] = await Promise.all([
    fetchText(`https://raw.githubusercontent.com/oaslananka/boardreadyops/${exactCommit}/action.yml`, fetchImpl),
    fetchText(
      `https://raw.githubusercontent.com/oaslananka/boardreadyops/${exactCommit}/apps/container/action.yml`,
      fetchImpl,
    ),
  ]);

  const formulaText = await readFile(join(root, "Formula/boardreadyops.rb"), "utf8");
  const formulaVersion = /\bversion\s+"([^"]+)"/.exec(formulaText)?.[1];
  const formulaDigests = [...formulaText.matchAll(/\bsha256\s+"([0-9a-f]{64})"/g)].map((match) => match[1]);

  return {
    version,
    expectedNodeEngines,
    npm: { version: npmPackage.version, latest: npmTags.latest, engines: npmPackage.engines?.node },
    release: {
      tag: release.tag_name,
      draft: release.draft,
      prerelease: release.prerelease,
      commit: exactCommit,
      assets,
    },
    floatingV1Commit,
    checksumEntries: parseChecksumFile(checksumText),
    downloadedAssetDigests: {
      SHA256SUMS: sha256(checksumBytes),
      "sbom.cyclonedx.json": sha256(sbomBytes),
    },
    ghcr,
    actionPins,
    actionMetadataMatchesRelease:
      localRootAction === releaseRootAction && localContainerAction === releaseContainerAction,
    formula: { version: formulaVersion, digests: formulaDigests },
  };
}

async function resolveGitHubTagCommit(tag, fetchImpl, headers) {
  const ref = await fetchJson(
    `https://api.github.com/repos/oaslananka/boardreadyops/git/ref/tags/${encodeURIComponent(tag)}`,
    fetchImpl,
    headers,
  );
  if (ref.object?.type === "commit") return ref.object.sha;
  if (ref.object?.type !== "tag" || !ref.object.sha) throw new Error(`GitHub tag ${tag} has no commit target`);
  const annotated = await fetchJson(
    `https://api.github.com/repos/oaslananka/boardreadyops/git/tags/${ref.object.sha}`,
    fetchImpl,
    headers,
  );
  if (annotated.object?.type !== "commit" || !annotated.object.sha) {
    throw new Error(`GitHub annotated tag ${tag} does not resolve directly to a commit`);
  }
  return annotated.object.sha;
}

async function fetchGhcrManifest(reference, fetchImpl) {
  const url = `https://ghcr.io/v2/oaslananka/boardreadyops-full/manifests/${reference}`;
  const headers = {
    Accept: "application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.list.v2+json",
    "User-Agent": "boardreadyops-release-channel-check",
  };
  let response = await fetchImpl(url, { headers });
  if (response.status === 401) {
    const challenge = parseBearerChallenge(response.headers.get("www-authenticate"));
    if (!challenge?.realm) throw new Error(`GHCR ${reference} did not provide a Bearer authentication challenge`);
    const tokenUrl = new URL(challenge.realm);
    if (challenge.service) tokenUrl.searchParams.set("service", challenge.service);
    if (challenge.scope) tokenUrl.searchParams.set("scope", challenge.scope);
    const tokenBody = await fetchJson(tokenUrl.toString(), fetchImpl);
    const token = tokenBody.token ?? tokenBody.access_token;
    if (!token) throw new Error(`GHCR ${reference} token response did not include a token`);
    response = await fetchImpl(url, { headers: { ...headers, Authorization: `Bearer ${token}` } });
  }
  if (!response.ok) throw new Error(`GHCR ${reference} returned ${response.status}`);
  const body = await response.json();
  const digest = response.headers.get("docker-content-digest");
  const platforms = (body.manifests ?? [])
    .map((manifest) => `${manifest.platform?.os ?? "unknown"}/${manifest.platform?.architecture ?? "unknown"}`)
    .filter((platform) => platform !== "unknown/unknown");
  return { digest, platforms };
}

function parseBearerChallenge(value) {
  if (!value?.startsWith("Bearer ")) return undefined;
  const fields = {};
  for (const match of value.slice(7).matchAll(/([a-z]+)="([^"]*)"/g)) fields[match[1]] = match[2];
  return fields;
}

function parseChecksumFile(text) {
  const entries = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{64})\s+\*?(.+)$/.exec(line.trim());
    if (match) entries[match[2]] = match[1];
  }
  return entries;
}

function normalizeSha256(value) {
  return typeof value === "string" && /^sha256:[0-9a-f]{64}$/.test(value) ? value.slice(7) : undefined;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function githubApiHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    "User-Agent": "boardreadyops-release-channel-check",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function fetchJson(url, fetchImpl, headers = {}) {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/json", "User-Agent": "boardreadyops-release-channel-check", ...headers },
  });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.json();
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { "User-Agent": "boardreadyops-release-channel-check" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return response.text();
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: { "User-Agent": "boardreadyops-release-channel-check" } });
  if (!response.ok) throw new Error(`${url} returned ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
}

async function main() {
  const result = await runReleaseChannelChecks();
  if (result.failures.length > 0) {
    for (const failure of result.failures) {
      process.stderr.write(`release channel check failed: ${failure.name}\n`);
      if (failure.details) process.stderr.write(`${JSON.stringify(failure.details, null, 2)}\n`);
    }
    process.exitCode = 1;
    return;
  }
  for (const item of result.checks) process.stdout.write(`ok: ${item}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
