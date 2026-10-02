export function runCommitCopyAccessibleLabel(repository: string, commitSha: string): string {
  return `Copy commit ${commitSha.slice(0, 7)} for ${repository}`;
}
