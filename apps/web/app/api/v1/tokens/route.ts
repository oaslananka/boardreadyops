import { ApiTokenStore } from "@boardreadyops/db";
import { z } from "zod";
import { authenticateApiRequest, resolveRepositoryApiContext } from "../../../../lib/api-auth.js";

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
  const ctx = await resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

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

  const { repositoryId: requestedRepositoryId, name, scopes, durationDays } = parsed.data;
  const ctx = await resolveRepositoryApiContext(auth, request, requestedRepositoryId);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;
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
  const ctx = await resolveRepositoryApiContext(auth, request);
  if (ctx instanceof Response) return ctx;
  const { repositoryId, executor } = ctx;

  const url = new URL(request.url);
  const tokenId = url.searchParams.get("tokenId");
  if (!tokenId) {
    await executor.close();
    return Response.json({ ok: false, error: "tokenId is required" }, { status: 400 });
  }

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
