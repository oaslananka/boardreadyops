import path from "node:path";
import type { BoardReadyOpsConfig } from "../../core/config.js";
import type { PipelineOptions, ProjectContext } from "../../core/context.js";
import { globFiles } from "../../util/glob.js";
import { projectScopedOutputFiles } from "../output-scope.js";

const bomPatterns = ["**/bom*.csv", "**/*bom*.csv", "**/bom*.tsv", "**/*bom*.tsv"];

/** Only implicitly discover BOM evidence belonging to the projects being checked. */
export async function resolveProjectBomPaths(
  root: string,
  projects: readonly ProjectContext[],
  options: PipelineOptions,
  config: BoardReadyOpsConfig,
): Promise<string[]> {
  if (options.bom && options.bom !== "auto") {
    return [path.resolve(root, options.bom)];
  }

  const configured = config.projects
    ?.filter(
      (entry) =>
        entry.bom &&
        (projects.length === 0 ||
          projects.some((project) => {
            const configuredProject = path.resolve(root, entry.path);
            return (
              configuredProject === path.resolve(root, project.projectFile) ||
              configuredProject === path.resolve(root, project.root)
            );
          })),
    )
    .flatMap((entry) => (entry.bom ? [path.resolve(root, entry.bom)] : []));
  if (configured && configured.length > 0) {
    return [...new Set(configured)].sort((a, b) => a.localeCompare(b));
  }

  // Preserve standalone BOM-only behavior when there is no KiCad project.
  return projects.length > 0 ? projectScopedOutputFiles(root, projects, bomPatterns) : globFiles(root, bomPatterns);
}
