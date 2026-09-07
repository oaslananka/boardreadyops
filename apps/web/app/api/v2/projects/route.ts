import { WorkspaceStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";
import { authorizeWorkspace, canWriteWorkspace } from "../../../../lib/workspace-authorization.js";

export const runtime = "nodejs";

const createProjectSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().min(1).max(128),
  description: z.string().max(1024).optional(),
  defaultCadFormat: z.enum(["kicad", "altium", "easyeda", "fusion360", "ipc2581", "generic_gerber"]).default("kicad"),
  githubRepoFullName: z.string().optional(),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "admin");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid project payload", issues: parsed.error.issues }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const access = await authorizeWorkspace(auth, store, parsed.data.workspaceId);
    if (!access.ok) {
      return Response.json({ ok: false, error: access.error }, { status: access.status });
    }
    if (!canWriteWorkspace(access.role)) {
      return Response.json({ ok: false, error: "Viewers cannot create projects" }, { status: 403 });
    }

    const project = await store.createProject({
      workspaceId: parsed.data.workspaceId,
      name: parsed.data.name,
      description: parsed.data.description,
      defaultCadFormat: parsed.data.defaultCadFormat,
      githubRepoFullName: parsed.data.githubRepoFullName,
    });
    return Response.json({ ok: true, project }, { status: 201 });
  } finally {
    await executor.close();
  }
}

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:read");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const workspaceId = url.searchParams.get("workspaceId");
  if (!workspaceId) {
    return Response.json({ ok: false, error: "Missing workspaceId query parameter" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const access = await authorizeWorkspace(auth, store, workspaceId);
    if (!access.ok) {
      return Response.json({ ok: false, error: access.error }, { status: access.status });
    }
    const projects = await store.listProjectsByWorkspace(workspaceId);
    return Response.json({ ok: true, projects });
  } finally {
    await executor.close();
  }
}
