import { type WorkspacePlanTier, WorkspaceStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createWorkspaceSchema = z.object({
  name: z.string().min(1).max(128),
  slug: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9-]+$/),
  planTier: z.enum(["community", "team", "business", "pilot"]).optional(),
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

  const parsed = createWorkspaceSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid workspace payload", issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (parsed.data.planTier && parsed.data.planTier !== "community") {
    return Response.json(
      { ok: false, error: "Paid plan tiers cannot be self-assigned at workspace creation" },
      { status: 400 },
    );
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const existing = await store.getWorkspaceBySlug(parsed.data.slug);
    if (existing) {
      return Response.json({ ok: false, error: "Workspace slug already exists" }, { status: 409 });
    }

    const workspace = await store.createWorkspace({
      name: parsed.data.name,
      slug: parsed.data.slug,
      planTier: parsed.data.planTier as WorkspacePlanTier | undefined,
    });
    return Response.json({ ok: true, workspace }, { status: 201 });
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
  const slug = url.searchParams.get("slug");
  if (!slug) {
    return Response.json({ ok: false, error: "Missing slug query parameter" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const workspace = await store.getWorkspaceBySlug(slug);
    if (!workspace) {
      return Response.json({ ok: false, error: "Workspace not found" }, { status: 404 });
    }
    return Response.json({ ok: true, workspace });
  } finally {
    await executor.close();
  }
}
