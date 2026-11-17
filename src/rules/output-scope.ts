import path from "node:path";
import type { ProjectContext } from "../core/context.js";
import { globFiles } from "../util/glob.js";

/**
 * Restricts manufacturing-output evidence to the KiCad project whose rules are running.
 * A project at the repository root still searches the whole repository. For nested
 * projects, sibling fixtures and other boards must not supply missing outputs or
 * contaminate findings. Paths and discovered files remain absolute until reporting.
 */
export async function projectScopedOutputFiles(
  root: string,
  projects: readonly ProjectContext[],
  patterns: string[],
): Promise<string[]> {
  const groups = await Promise.all(projects.map((project) => globFiles(path.resolve(root, project.root), patterns)));
  return [...new Set(groups.flat())].sort((a, b) => a.localeCompare(b));
}
