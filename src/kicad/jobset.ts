import path from "node:path";
import { parseJsonValue } from "../util/json.js";
import { runProcess } from "../util/process.js";
import { redactControlCharacters } from "../util/strings.js";
import { readDesignFile } from "./parsers/project-files.js";
import { extractBlocks, sexprStringAfter } from "./sexpr.js";

export interface KicadJobset {
  jobs: Array<{ type: string; outputPath: string; enabled: boolean; destinationPath?: string | undefined }>;
}

export interface JobsetResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

interface RawJob {
  type?: unknown;
  kind?: unknown;
  outputPath?: unknown;
  output_path?: unknown;
  output?: unknown;
  destinationPath?: unknown;
  destination_path?: unknown;
  destination?: unknown;
  outputDirectory?: unknown;
  output_directory?: unknown;
  enabled?: unknown;
}

export async function parseJobset(file: string): Promise<KicadJobset> {
  const text = (await readDesignFile(file)) ?? "";
  const parsed = parseJsonValue(text);
  if (parsed) {
    return { jobs: collectJsonJobs(parsed) };
  }
  return { jobs: collectSexprJobs(text) };
}

export async function runJobset(cliPath: string, projectFile: string, outputDir: string): Promise<JobsetResult> {
  const result = await runProcess(cliPath, ["jobset", "run", "--output", outputDir, projectFile], {
    timeoutMs: 120_000,
    maxStdoutBytes: 256 * 1024,
    maxStderrBytes: 256 * 1024,
  });
  return {
    code: result.code ?? 1,
    stdout: redactControlCharacters(result.stdout),
    stderr: redactControlCharacters(result.stderr),
    timedOut: result.timedOut,
  };
}

function collectJsonJobs(input: unknown): KicadJobset["jobs"] {
  const jobs: KicadJobset["jobs"] = [];
  const stack = [input];
  while (stack.length > 0) {
    const item = stack.pop();
    if (Array.isArray(item)) {
      if (item.every((entry) => isRawJob(entry))) {
        jobs.push(...item.map(normalizeRawJob).filter((job): job is KicadJobset["jobs"][number] => Boolean(job)));
      }
      stack.push(...item);
      continue;
    }
    if (item && typeof item === "object") {
      const record = item as Record<string, unknown>;
      if (Array.isArray(record.jobs)) {
        jobs.push(
          ...record.jobs.map(normalizeRawJob).filter((job): job is KicadJobset["jobs"][number] => Boolean(job)),
        );
      }
      stack.push(...Object.values(record));
    }
  }
  return uniqueJobs(jobs);
}

function collectSexprJobs(text: string): KicadJobset["jobs"] {
  const jobs: KicadJobset["jobs"] = [];
  for (const body of extractBlocks(text, "job")) {
    const type = sexprStringAfter(body, "job") ?? "job";
    const output = /\(output(?:_path)?\s+"([^"]+)"/.exec(body)?.[1];
    if (!output) {
      continue;
    }
    const destinationPath =
      /\(destination(?:_path)?\s+"([^"]+)"/.exec(body)?.[1] ?? /\(output_(?:dir|directory)\s+"([^"]+)"/.exec(body)?.[1];
    jobs.push({
      type,
      outputPath: normalizePath(output),
      ...(destinationPath ? { destinationPath: normalizePath(destinationPath) } : {}),
      enabled: !/\(\s*enabled\s+false\s*\)/.test(body),
    });
  }
  return jobs;
}

function isRawJob(input: unknown): input is RawJob {
  return Boolean(input && typeof input === "object");
}

function normalizeRawJob(input: unknown): KicadJobset["jobs"][number] | undefined {
  if (!isRawJob(input)) {
    return undefined;
  }
  const type = input.type ?? input.kind;
  const outputPath = input.outputPath ?? input.output_path ?? input.output;
  const destinationPath =
    input.destinationPath ??
    input.destination_path ??
    input.destination ??
    input.outputDirectory ??
    input.output_directory;
  if (typeof type !== "string" || typeof outputPath !== "string") {
    return undefined;
  }
  return {
    type,
    outputPath: normalizePath(outputPath),
    ...(typeof destinationPath === "string" ? { destinationPath: normalizePath(destinationPath) } : {}),
    enabled: input.enabled !== false,
  };
}

function uniqueJobs(jobs: KicadJobset["jobs"]): KicadJobset["jobs"] {
  const seen = new Set<string>();
  const output: KicadJobset["jobs"] = [];
  for (const job of jobs) {
    const key = `${job.type}\0${job.destinationPath ?? ""}\0${job.outputPath}\0${job.enabled}`;
    if (!seen.has(key)) {
      seen.add(key);
      output.push(job);
    }
  }
  return output;
}

function normalizePath(value: string): string {
  return path.normalize(value).replaceAll("\\", "/");
}
