import { randomUUID } from "node:crypto";

export async function migrateInstallationsToWorkspaces(executor) {
  let workspacesCreated = 0;
  let projectsCreated = 0;

  // 1. Fetch existing installations
  const instResult = await executor.query("select id, account_login, plan_tier from installations");
  const installations = instResult?.rows ?? [];

  const workspaceByInstallationId = new Map();

  for (const inst of installations) {
    const slug = `gh-${String(inst.account_login)
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, "-")}`;

    // Check if workspace with this slug already exists
    const existing = await executor.query("select id, name, slug from workspaces where slug = $1", [slug]);
    let workspaceId;
    if (existing?.rows && existing.rows.length > 0) {
      workspaceId = existing.rows[0].id;
    } else {
      workspaceId = `ws_gh_${inst.id ?? randomUUID()}`;
      await executor.query("insert into workspaces (id, name, slug, plan_tier) values ($1, $2, $3, $4)", [
        workspaceId,
        inst.account_login,
        slug,
        inst.plan_tier ?? "community",
      ]);
      workspacesCreated += 1;
    }

    workspaceByInstallationId.set(inst.id, workspaceId);
  }

  // 2. Fetch existing repositories
  const repoResult = await executor.query("select id, installation_id, owner, name from repositories");
  const repositories = repoResult?.rows ?? [];

  for (const repo of repositories) {
    const workspaceId = workspaceByInstallationId.get(repo.installation_id);
    if (!workspaceId) continue;

    const repoFullName = `${repo.owner}/${repo.name}`;
    const existingPrj = await executor.query("select id from projects where github_repo_full_name = $1", [
      repoFullName,
    ]);

    if (!existingPrj?.rows || existingPrj.rows.length === 0) {
      const projectId = `prj_gh_${repo.id ?? randomUUID()}`;
      await executor.query(
        "insert into projects (id, workspace_id, name, github_repo_full_name) values ($1, $2, $3, $4)",
        [projectId, workspaceId, repo.name, repoFullName],
      );
      projectsCreated += 1;
    }
  }

  return {
    workspacesCreated,
    projectsCreated,
  };
}
