import { ApiTokenStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createTokenSchema = z.object({
  repositoryId: z.string().min(1),
  name: z.string().min(1).max(128),
  scopes: z
    .array(z.enum(["runs:write", "reviews:read", "reviews:write", "admin"]))
    .default(["runs:write", "reviews:read", "reviews:write"]),
  durationDays: z.number().int().min(1).max(365).optional(),
});

export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "admin");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");
  if (!repositoryId) {
    return Response.json({ ok: false, error: "repositoryId is required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ApiTokenStore(executor);
    const tokens = await store.listTokens(repositoryId);
    return Response.json({ ok: true, tokens });
  } finally {
    await executor.close();
  }
}

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

  const parsed = createTokenSchema.safeParse(body);
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Invalid token payload", issues: parsed.error.issues }, { status: 400 });
  }

  const { repositoryId, name, scopes, durationDays } = parsed.data;
  if (auth.repositoryId && auth.repositoryId !== repositoryId) {
    return Response.json({ ok: false, error: "Forbidden repository scope" }, { status: 403 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ApiTokenStore(executor);
    const result = await store.createToken({
      repositoryId,
      name,
      scopes,
      createdBy: auth.actorId,
      ...(durationDays !== undefined ? { durationDays } : {}),
    });

    return Response.json(
      {
        ok: true,
        token: result.token,
        tokenRecord: result.record,
      },
      { status: 201 },
    );
  } finally {
    await executor.close();
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "admin");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  const url = new URL(request.url);
  const tokenId = url.searchParams.get("tokenId");
  const repositoryId = auth.repositoryId ?? url.searchParams.get("repositoryId");

  if (!tokenId || !repositoryId) {
    return Response.json({ ok: false, error: "tokenId and repositoryId are required" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new ApiTokenStore(executor);
    const revoked = await store.revokeToken(repositoryId, tokenId);
    if (!revoked) {
      return Response.json({ ok: false, error: "Token not found or already revoked" }, { status: 404 });
    }
    return Response.json({ ok: true, revoked: true });
  } finally {
    await executor.close();
  }
}
