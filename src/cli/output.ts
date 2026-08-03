import path from "node:path";
import type { LoadedConfig } from "../core/config.js";
import type { RunResult } from "../core/result.js";
import type { Locale } from "../i18n/t.js";
import { formatHtml } from "../report/html.js";
import type { ReportArtifact } from "../report/html-render.js";
import { formatJson } from "../report/json.js";
import { formatJunit } from "../report/junit.js";
import { formatMarkdown } from "../report/markdown.js";
import { formatSarif } from "../report/sarif.js";
import { writeTextFile } from "../util/fs.js";
import { normalizePathInput } from "../util/path.js";

export interface OutputOptions {
  json?: string | undefined;
  sarif?: string | undefined;
  markdown?: string | undefined;
  junit?: string | undefined;
  html?: string | undefined;
}

export async function writeReports(
  result: RunResult,
  root: string,
  outputs: OutputOptions,
  loaded: LoadedConfig,
  stdout: NodeJS.WritableStream,
  locale: Locale = "en",
): Promise<{ json?: string; sarif?: string; markdown?: string; junit?: string; html?: string }> {
  const targets = {
    json: outputs.json ?? configOutput(loaded, "json"),
    sarif: outputs.sarif ?? configOutput(loaded, "sarif"),
    markdown: outputs.markdown ?? configOutput(loaded, "markdown"),
    junit: outputs.junit ?? configOutput(loaded, "junit"),
    html: outputs.html ?? configOutput(loaded, "html"),
  };
  const written: { json?: string; sarif?: string; markdown?: string; junit?: string; html?: string } = {};
  if (targets.json) {
    written.json = await writeOrStdout(root, targets.json, formatJson(result), stdout);
  }
  if (targets.sarif) {
    written.sarif = await writeOrStdout(root, targets.sarif, formatSarif(result), stdout);
  }
  if (targets.markdown) {
    written.markdown = await writeOrStdout(
      root,
      targets.markdown,
      formatMarkdown(result, [], undefined, locale),
      stdout,
    );
  }
  if (targets.junit) {
    written.junit = await writeOrStdout(root, targets.junit, formatJunit(result), stdout);
  }
  if (targets.html) {
    const artifacts = targets.html === "-" ? [] : htmlArtifactLinks(root, targets, targets.html);
    written.html = await writeOrStdout(root, targets.html, formatHtml(result, locale, artifacts), stdout);
  }
  return written;
}

const ARTIFACT_LABELS: Record<"json" | "sarif" | "markdown" | "junit", string> = {
  json: "JSON report",
  sarif: "SARIF report",
  markdown: "Markdown report",
  junit: "JUnit report",
};

function htmlArtifactLinks(
  root: string,
  targets: {
    json?: string | undefined;
    sarif?: string | undefined;
    markdown?: string | undefined;
    junit?: string | undefined;
  },
  htmlTarget: string,
): ReportArtifact[] {
  const htmlDir = path.dirname(path.resolve(root, normalizePathInput(htmlTarget)));
  const artifacts: ReportArtifact[] = [];
  for (const key of ["json", "sarif", "markdown", "junit"] as const) {
    const target = targets[key];
    if (!target || target === "-") {
      continue;
    }
    const href = path
      .relative(htmlDir, path.resolve(root, normalizePathInput(target)))
      .split(path.sep)
      .join("/");
    artifacts.push({ label: ARTIFACT_LABELS[key], href });
  }
  return artifacts;
}

function configOutput(loaded: LoadedConfig, key: "json" | "sarif" | "markdown" | "junit" | "html"): string | undefined {
  const val = loaded.config.report?.[key];
  return typeof val === "string" ? val : undefined;
}

async function writeOrStdout(
  root: string,
  target: string,
  content: string,
  stdout: NodeJS.WritableStream,
): Promise<string> {
  if (target === "-") {
    stdout.write(content);
    return "-";
  }
  const file = path.resolve(root, normalizePathInput(target));
  await writeTextFile(file, content);
  return file;
}
