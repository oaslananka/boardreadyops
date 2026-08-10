import fs from "node:fs/promises";
import path from "node:path";
import { globFiles } from "../util/glob.js";
import { normalizePathInput, normalizeRelative } from "../util/path.js";
import type { ProjectContext } from "./context.js";

export async function discoverProjects(root: string, explicitProject?: string): Promise<ProjectContext[]> {
  const projectFiles = explicitProject
    ? await explicitProjectFiles(root, explicitProject)
    : (await globFiles(root, ["**/*.kicad_pro"])).map((file) => path.resolve(file));
  const contexts: ProjectContext[] = [];
  const projectFilesSorted = [...projectFiles].sort((a, b) => a.localeCompare(b));
  for (const projectFile of projectFilesSorted) {
    contexts.push(await projectContext(root, projectFile));
  }
  return contexts;
}

async function explicitProjectFiles(root: string, explicitProject: string): Promise<string[]> {
  const target = path.resolve(root, normalizePathInput(explicitProject));
  try {
    const stat = await fs.stat(target);
    if (stat.isDirectory()) {
      const files = await globFiles(target, ["**/*.kicad_pro"]);
      return files.map((file) => path.resolve(file));
    }
  } catch {
    // Fall through to explicit file. Missing files are reported by project rules.
  }
  return [target];
}

async function projectContext(root: string, projectFile: string): Promise<ProjectContext> {
  const projectRoot = path.dirname(projectFile);
  const base = path.basename(projectFile, ".kicad_pro");
  const entries = await safeReadDir(projectRoot);
  const schematicFiles = entries
    .filter(
      (file) => file.endsWith(".kicad_sch") && (path.basename(file, ".kicad_sch") === base || entries.length === 1),
    )
    .map((file) => path.join(projectRoot, file));
  const boardFiles = entries
    .filter((file) => file.endsWith(".kicad_pcb") && path.basename(file, ".kicad_pcb") === base)
    .map((file) => path.join(projectRoot, file));
  const jobsetFiles = await discoverJobsets(projectRoot);
  return {
    projectFile: normalizeRelative(root, projectFile),
    root: normalizeRelative(root, projectRoot),
    schematicFiles: schematicFiles.map((file) => normalizeRelative(root, file)),
    boardFiles: boardFiles.map((file) => normalizeRelative(root, file)),
    jobsetFiles: jobsetFiles.map((file) => normalizeRelative(root, file)),
  };
}

async function discoverJobsets(projectRoot: string): Promise<string[]> {
  const discovered = await globFiles(projectRoot, ["**/*.kicad_jobset", "**/*.kicad_jobs"]);
  const scoped: string[] = [];
  for (const file of discovered.map((entry) => path.resolve(entry))) {
    if (!(await isInsideNestedProject(projectRoot, file))) {
      scoped.push(file);
    }
  }
  return [...new Set(scoped)].sort((left, right) => left.localeCompare(right));
}

async function isInsideNestedProject(projectRoot: string, file: string): Promise<boolean> {
  const stop = path.resolve(projectRoot);
  let current = path.dirname(path.resolve(file));
  while (current !== stop) {
    const entries = await safeReadDir(current);
    if (entries.some((entry) => entry.endsWith(".kicad_pro"))) {
      return true;
    }
    current = path.dirname(current);
  }
  return false;
}

async function safeReadDir(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}
