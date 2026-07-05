import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { discoverProjects } from "../../core/discovery.js";
import { canonicalRoot, runPipeline } from "../../core/pipeline.js";
import { resolveLocale, t } from "../../i18n/t.js";
import { detectKicadCli } from "../../kicad/cli.js";
import { runJobset } from "../../kicad/jobset.js";
import { diffReleases, formatReleaseDiffText, type ReleaseSnapshot } from "../../release/diff.js";
import { verifyReleaseEvidenceBundle, writeReleaseEvidenceBundle } from "../../release/evidence.js";
import { createKicadCliRunner, DEFAULT_GENERATE_RECIPE, runGenerate } from "../../release/generate.js";
import {
  buildHandoffManifest,
  type HandoffManifestFile,
  type HandoffProfileSummary,
  planHandoffPackage,
  renderHandoffReadme,
} from "../../release/handoff.js";
import {
  buildReleasePrepareSummary,
  type PrepareGenerationStage,
  type PrepareValidationStage,
  releasePrepareExitCode,
} from "../../release/prepare.js";
import { signReleaseBundle, verifyReleaseBundleSignature } from "../../release/signing.js";
import { formatHtml } from "../../report/html.js";
import { pathExists, readTextFile, sha256File, writeTextFile } from "../../util/fs.js";
import { globFiles } from "../../util/glob.js";
import { normalizePathInput, normalizeRelative } from "../../util/path.js";
import { createZipBuffer } from "../../util/zip.js";
import { VENDOR_OUTPUT_KINDS, VENDOR_OUTPUT_PATTERNS } from "../../vendor/outputs.js";
import { listVendorProfiles, resolveVendorProfile } from "../../vendor/profiles.js";
import { type CommonCliOptions, loadConfigOrReportErrors, pipelineInputFromCli } from "./run.js";

const execFileAsync = promisify(execFile);

export interface ReleasePackOptions extends CommonCliOptions {
  output?: string;
  includeGenerated?: string;
  provenanceSource?: string;
  provenanceAttestation?: string;
}

export interface ReleasePrepareOptions extends CommonCliOptions {
  output?: string;
  skipGenerate?: boolean;
}

export interface ReleaseVerifyOptions {
  format?: "text" | "json";
  publicKey?: string;
}

export interface ReleaseSignOptions {
  key?: string;
}

export interface ReleaseHandoffOptions {
  profile?: string;
  service?: "fabrication" | "assembly" | "fabrication+assembly";
  output?: string;
  format?: "text" | "json";
  zip?: boolean;
}

export interface ReleaseDiffOptions extends CommonCliOptions {
  output?: string;
  format?: "text" | "json";
  html?: string;
}

export async function releasePackCommand(
  pathInput: string | undefined,
  options: ReleasePackOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const git = await gitState(root);
  const result = await runPipeline(pipelineInputFromCli(root, options, false));
  const bundle = await writeReleaseEvidenceBundle(root, result, {
    outputDir: options.output ?? "build/boardreadyops-release",
    gitSha: git.sha,
    gitDirty: git.dirty,
    includeGenerated: options.includeGenerated,
    provenance: {
      attestation: options.provenanceAttestation,
      source: options.provenanceSource,
    },
  });
  streams.stdout.write(`Release evidence bundle written to ${normalizeRelative(root, bundle.outputDir)}\n`);
  streams.stdout.write(`Manifest: ${normalizeRelative(root, bundle.manifestPath)}\n`);
  streams.stdout.write(`Checksums: ${normalizeRelative(root, bundle.checksumsPath)}\n`);
  streams.stdout.write(`Decision: ${bundle.manifest.decision.status.toUpperCase()}\n`);
  streams.stdout.write(`Artifacts: ${bundle.manifest.artifacts.length}; gaps: ${bundle.manifest.gaps.length}\n`);
  return result.summary.failed ? 1 : 0;
}

export async function releasePrepareCommand(
  pathInput: string | undefined,
  options: ReleasePrepareOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const locale = resolveLocale();
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  if (!(await loadConfigOrReportErrors(root, options.config, streams, locale))) {
    return 2;
  }

  const outputDir = normalizePathInput(options.output ?? "build/boardreadyops-release");
  const generation = await runGenerationStage(root, outputDir, options, streams, locale);
  if (generation.kind === "require-kicad") {
    return 3;
  }

  const result = await runPipeline(pipelineInputFromCli(root, options, false));
  const validate: PrepareValidationStage = {
    status: result.summary.failed ? "failed" : "passed",
    summary: result.summary,
  };

  const summary = buildReleasePrepareSummary({ generate: generation.stage, validate });
  await writeTextFile(path.resolve(root, outputDir, "release-prepare.json"), `${JSON.stringify(summary, null, 2)}\n`);

  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } else {
    writePrepareSummary(summary, outputDir, streams.stdout);
  }
  return releasePrepareExitCode(summary);
}

type GenerationStageResult = { kind: "stage"; stage: PrepareGenerationStage } | { kind: "require-kicad" };

async function runGenerationStage(
  root: string,
  outputDir: string,
  options: ReleasePrepareOptions,
  streams: { stderr: NodeJS.WritableStream },
  locale: ReturnType<typeof resolveLocale>,
): Promise<GenerationStageResult> {
  if (options.skipGenerate) {
    return { kind: "stage", stage: { status: "skipped", reason: "generation skipped via --skip-generate" } };
  }
  const cli = await detectKicadCli(options.kicadCli);
  if (!cli.found || !cli.path) {
    if (options.requireKicad) {
      streams.stderr.write(`${t("cli.error.environment.kicadMissing", {}, locale)}\n`);
      return { kind: "require-kicad" };
    }
    return { kind: "stage", stage: { status: "skipped", reason: "kicad-cli not available" } };
  }
  const projects = await discoverProjects(root, options.project);
  const project = projects[0];
  if (!project) {
    return { kind: "stage", stage: { status: "skipped", reason: "no KiCad project found" } };
  }
  const generateOutputDir = path.resolve(root, outputDir, "outputs");
  const generated = await runGenerate(DEFAULT_GENERATE_RECIPE, {
    outputDir: path.join(generateOutputDir, "default"),
    boardFile: project.boardFiles[0] ? path.resolve(root, project.boardFiles[0]) : undefined,
    schematicFile: project.schematicFiles[0] ? path.resolve(root, project.schematicFiles[0]) : undefined,
    variant: options.variant,
    runner: createKicadCliRunner(cli.path),
    projectName: path.basename(project.projectFile, ".kicad_pro"),
  });
  const jobsetRun = await runProjectJobsets(root, project, cli.path, generateOutputDir);
  const failures = generated.failures + jobsetRun.failures;
  return {
    kind: "stage",
    stage: {
      status: failures > 0 ? "failed" : "generated",
      artifacts: generated.artifacts.length + jobsetRun.artifacts,
      failures,
      outputDir: normalizeRelative(root, generateOutputDir),
    },
  };
}

async function runProjectJobsets(
  root: string,
  project: Awaited<ReturnType<typeof discoverProjects>>[number],
  cliPath: string,
  outputDir: string,
): Promise<{ artifacts: number; failures: number }> {
  if (project.jobsetFiles.length === 0) {
    return { artifacts: 0, failures: 0 };
  }
  const jobsetOutputDir = path.join(outputDir, "jobsets");
  await fs.mkdir(jobsetOutputDir, { recursive: true });
  const result = await runJobset(cliPath, path.resolve(root, project.projectFile), jobsetOutputDir);
  await writeTextFile(
    path.join(jobsetOutputDir, "boardreadyops-jobset-run.json"),
    `${JSON.stringify(
      {
        schemaVersion: 1,
        project: normalizeRelative(root, project.projectFile),
        jobsets: project.jobsetFiles,
        outputDir: normalizeRelative(root, jobsetOutputDir),
        status: result.code === 0 ? "generated" : "failed",
        code: result.code,
        timedOut: result.timedOut,
      },
      null,
      2,
    )}
`,
  );
  const artifacts = await globFiles(jobsetOutputDir, ["**/*"]);
  return { artifacts: artifacts.length, failures: result.code === 0 ? 0 : 1 };
}

function writePrepareSummary(
  summary: ReturnType<typeof buildReleasePrepareSummary>,
  outputDir: string,
  stdout: NodeJS.WritableStream,
): void {
  const { generate, validate } = summary.stages;
  stdout.write(`Release prepare decision: ${summary.decision.status.toUpperCase()}\n`);
  const generateDetail =
    generate.status === "generated"
      ? ` (${generate.artifacts ?? 0} artifacts)`
      : generate.reason
        ? ` (${generate.reason})`
        : "";
  stdout.write(`  generate: ${generate.status}${generateDetail}\n`);
  stdout.write(
    `  validate: ${validate.status} (${validate.summary.total} findings, max ${validate.summary.maxSeverity})\n`,
  );
  for (const reason of summary.decision.reasons) {
    stdout.write(`  - ${reason}\n`);
  }
  stdout.write(`Summary written to ${path.join(outputDir, "release-prepare.json")}\n`);
}

export async function releaseVerifyCommand(
  bundleInput: string | undefined,
  options: ReleaseVerifyOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const bundleDir = path.resolve(normalizePathInput(bundleInput ?? "build/boardreadyops-release"));
  const verification = await verifyReleaseEvidenceBundle(bundleDir);

  let trustedKey: string | undefined;
  if (options.publicKey) {
    try {
      trustedKey = await readTextFile(path.resolve(normalizePathInput(options.publicKey)));
    } catch {
      streams.stderr.write(`Public key not found: ${options.publicKey}\n`);
      return 2;
    }
  }
  const signature = await verifyReleaseBundleSignature(bundleDir, trustedKey);
  const signatureRequired = Boolean(options.publicKey);
  const signatureErrors = [...signature.errors];
  if (signatureRequired && !signature.present) {
    signatureErrors.push("expected a signed manifest (manifest.sig) but none was found");
  }
  const signatureOk = signatureErrors.length === 0 && (signature.present || !signatureRequired);
  const ok = verification.ok && signatureOk;

  if (options.format === "json") {
    streams.stdout.write(
      `${JSON.stringify(
        { ...verification, ok, signature: { present: signature.present, ok: signatureOk, errors: signatureErrors } },
        null,
        2,
      )}\n`,
    );
  } else if (ok) {
    const signatureNote = signature.present ? " and Ed25519 signature" : "";
    streams.stdout.write(`Release evidence bundle verified: ${verification.checked} artifact(s)${signatureNote}\n`);
  } else {
    streams.stderr.write(
      `Release evidence bundle verification failed: ${[...verification.errors, ...signatureErrors].join("; ")}\n`,
    );
  }
  return ok ? 0 : 1;
}

export async function releaseSignCommand(
  bundleInput: string | undefined,
  options: ReleaseSignOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const bundleDir = path.resolve(normalizePathInput(bundleInput ?? "build/boardreadyops-release"));
  if (!options.key) {
    streams.stderr.write("A private key is required: pass --key <path to an Ed25519 private key PEM>.\n");
    return 2;
  }
  if (!(await pathExists(path.join(bundleDir, "manifest.json")))) {
    streams.stderr.write(`No manifest.json found in ${bundleDir}. Run \`release pack\` first.\n`);
    return 2;
  }
  let privateKeyPem: string;
  try {
    privateKeyPem = await readTextFile(path.resolve(normalizePathInput(options.key)));
  } catch {
    streams.stderr.write(`Private key not found: ${options.key}\n`);
    return 2;
  }
  try {
    const result = await signReleaseBundle(bundleDir, privateKeyPem, new Date().toISOString());
    streams.stdout.write(`Signed release manifest with an Ed25519 key.\n`);
    streams.stdout.write(`Signature written to ${path.relative(process.cwd(), result.signaturePath)}\n`);
    return 0;
  } catch (error) {
    streams.stderr.write(`Signing failed: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
}

export async function releaseHandoffCommand(
  pathInput: string | undefined,
  options: ReleaseHandoffOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const profileId = options.profile ?? "jlcpcb";
  const resolved = resolveVendorProfile({
    profile: profileId,
    ...(options.service ? { service: options.service } : {}),
  });
  if (!resolved) {
    const known = listVendorProfiles()
      .map((profile) => profile.id)
      .join(", ");
    streams.stderr.write(`Unknown vendor profile: ${profileId}. Known profiles: ${known}\n`);
    return 2;
  }

  const summary: HandoffProfileSummary = {
    id: resolved.profile.id,
    name: resolved.profile.name,
    service: options.service ?? resolved.profile.service,
    requiredOutputs: resolved.requiredOutputs,
    assumptions: resolved.assumptions,
    caveats: resolved.profile.caveats,
  };

  const outputDir = path.resolve(root, normalizePathInput(options.output ?? "build/boardreadyops-handoff"));
  const outputDirPrefix = `${normalizeRelative(root, outputDir)}/`;
  const outputs: Record<string, string[]> = {};
  for (const kind of VENDOR_OUTPUT_KINDS) {
    const files = await globFiles(root, VENDOR_OUTPUT_PATTERNS[kind]);
    // Exclude anything inside the package output directory so re-runs stay idempotent.
    outputs[kind] = files
      .map((file) => normalizeRelative(root, file))
      .filter((file) => !file.startsWith(outputDirPrefix));
  }

  const plan = planHandoffPackage(outputs, summary);
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  const manifestFiles: HandoffManifestFile[] = [];
  for (const file of plan.files) {
    const target = path.join(outputDir, file.target);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.copyFile(path.resolve(root, file.source), target);
    const digest = await sha256File(target);
    manifestFiles.push({ ...file, ...digest });
  }

  const generatedAt = new Date().toISOString();
  const manifest = buildHandoffManifest(summary, plan, manifestFiles, generatedAt);
  await writeTextFile(path.join(outputDir, "handoff-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeTextFile(path.join(outputDir, "README.md"), renderHandoffReadme(summary, plan, generatedAt));

  let zipPath: string | undefined;
  if (options.zip !== false) {
    zipPath = `${outputDir}.zip`;
    const allFiles = await collectDirEntries(outputDir, outputDir);
    const zipBuffer = createZipBuffer(allFiles, new Date(generatedAt));
    await fs.writeFile(zipPath, zipBuffer);
  }

  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
  } else {
    streams.stdout.write(`Manufacturer handoff package written to ${normalizeRelative(root, outputDir)}\n`);
    if (zipPath) {
      streams.stdout.write(`Zip archive: ${normalizeRelative(root, zipPath)}\n`);
    }
    streams.stdout.write(`Vendor: ${summary.name} (${summary.id}); status: ${manifest.decision.status}\n`);
    streams.stdout.write(`Files: ${manifest.files.length}; included: ${plan.includedOutputs.join(", ") || "none"}\n`);
    if (plan.missingOutputs.length > 0) {
      streams.stdout.write(`Missing required outputs: ${plan.missingOutputs.join(", ")}\n`);
    }
  }
  return plan.missingOutputs.length > 0 ? 1 : 0;
}

export async function releaseDiffCommand(
  previousInput: string | undefined,
  pathInput: string | undefined,
  options: ReleaseDiffOptions,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): Promise<number> {
  if (!previousInput) {
    streams.stderr.write("A previous release report or evidence bundle is required.\n");
    return 2;
  }
  const root = await canonicalRoot(path.resolve(normalizePathInput(pathInput ?? ".")));
  const previous = await loadReleaseSnapshot(path.resolve(normalizePathInput(previousInput)));
  if (!previous) {
    streams.stderr.write(`Could not read a previous release report from ${previousInput}.\n`);
    return 2;
  }

  const result = await runPipeline(pipelineInputFromCli(root, options, false));
  const current: ReleaseSnapshot = {
    fabrication: result.fabrication,
    findings: result.findings,
    ...(result.readiness ? { readiness: result.readiness } : {}),
  };
  const diff = diffReleases(previous, current);

  if (options.output) {
    await writeTextFile(path.resolve(root, normalizePathInput(options.output)), `${JSON.stringify(diff, null, 2)}\n`);
  }
  if (options.html) {
    await writeTextFile(
      path.resolve(root, normalizePathInput(options.html)),
      formatHtml(result, resolveLocale(), [], diff.fabrication),
    );
  }
  if (options.format === "json") {
    streams.stdout.write(`${JSON.stringify(diff, null, 2)}\n`);
  } else {
    streams.stdout.write(formatReleaseDiffText(diff));
  }
  return 0;
}

async function loadReleaseSnapshot(input: string): Promise<ReleaseSnapshot | undefined> {
  const candidates = [
    input,
    path.join(input, "reports", "boardreadyops-report.json"),
    path.join(input, "manifest.json"),
  ];
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue;
    }
    try {
      const parsed = JSON.parse(await readTextFile(candidate)) as Partial<ReleaseSnapshot>;
      if (parsed.fabrication && Array.isArray(parsed.findings)) {
        return {
          fabrication: parsed.fabrication,
          findings: parsed.findings,
          ...(parsed.readiness ? { readiness: parsed.readiness } : {}),
        };
      }
    } catch {
      // try the next candidate
    }
  }
  return undefined;
}

async function collectDirEntries(dir: string, baseDir: string): Promise<Array<{ name: string; data: Buffer }>> {
  const entries: Array<{ name: string; data: Buffer }> = [];
  const items = await fs.readdir(dir, { withFileTypes: true });
  for (const item of items) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) {
      entries.push(...(await collectDirEntries(full, baseDir)));
    } else if (item.isFile()) {
      const rel = path.relative(baseDir, full).replace(/\\/g, "/");
      entries.push({ name: rel, data: await fs.readFile(full) });
    }
  }
  return entries;
}

async function gitState(root: string): Promise<{ sha?: string; dirty?: boolean }> {
  try {
    const [{ stdout: sha }, { stdout: status }] = await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root }),
      execFileAsync("git", ["status", "--porcelain"], { cwd: root }),
    ]);
    const trimmedSha = sha.trim();
    return trimmedSha ? { sha: trimmedSha, dirty: status.trim().length > 0 } : { dirty: status.trim().length > 0 };
  } catch {
    return {};
  }
}
