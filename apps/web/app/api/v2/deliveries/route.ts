import { WorkspaceStore } from "@boardreadyops/db";
import { createPgQueryExecutor } from "@boardreadyops/db/pg-executor";
import { z } from "zod";
import { authenticateApiRequest } from "../../../../lib/api-auth.js";
import { resolveCloudPersistenceConfiguration } from "../../../../lib/cloud-runtime-config.js";

export const runtime = "nodejs";

const createDeliverySchema = z.object({
  revisionId: z.string().min(1),
  expiresAt: z
    .string()
    .datetime()
    .optional()
    .default(() => new Date(Date.now() + 7 * 86400 * 1000).toISOString()),
  signedArchiveUrl: z.string().url(),
  recipientNotes: z.string().max(2048).optional(),
});

export async function POST(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(request, "reviews:write");
  if (!auth.ok) {
    return Response.json({ ok: false, error: auth.error }, { status: auth.status });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createDeliverySchema.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid delivery payload", issues: parsed.error.issues },
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
    const revision = await store.getRevisionById(parsed.data.revisionId);
    if (!revision) {
      return Response.json({ ok: false, error: "Revision not found" }, { status: 404 });
    }

    const { delivery, rawToken } = await store.createDeliveryLink({
      revisionId: parsed.data.revisionId,
      expiresAt: parsed.data.expiresAt,
      signedArchiveUrl: parsed.data.signedArchiveUrl,
      recipientNotes: parsed.data.recipientNotes,
    });
    return Response.json({ ok: true, delivery, rawToken }, { status: 201 });
  } finally {
    await executor.close();
  }
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return Response.json({ ok: false, error: "Missing token query parameter" }, { status: 400 });
  }

  const config = resolveCloudPersistenceConfiguration();
  if (config.mode !== "postgres") {
    return Response.json({ ok: false, error: "Database not configured" }, { status: 503 });
  }

  const executor = createPgQueryExecutor({ connectionString: config.databaseUrl });
  try {
    const store = new WorkspaceStore(executor);
    const delivery = await store.getDeliveryByToken(token);
    if (!delivery) {
      return Response.json({ ok: false, error: "Delivery not found or token expired" }, { status: 404 });
    }
    return Response.json({ ok: true, delivery });
  } finally {
    await executor.close();
  }
}
