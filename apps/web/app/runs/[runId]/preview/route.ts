import { loadRunDashboard, runDashboardLoaderDependencies } from "../../../../lib/run-dashboard.js";
import { loadRunNativeDesignPreview } from "../../../../lib/run-design-snapshots.js";
import { viewerAuthorization } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteProps = { params: Promise<{ runId: string }> };
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const privateHeaders = { "Cache-Control": "private, no-store", Vary: "Cookie" };

/** The actual native KiCad plot, never a demo placeholder or manufactured verdict. */
export async function GET(request: Request, { params }: RouteProps): Promise<Response> {
  const { runId } = await params;
  if (!uuid.test(runId)) return new Response(null, { status: 404, headers: privateHeaders });
  const kinds = new URL(request.url).searchParams.getAll("kind");
  if (kinds.length !== 1 || (kinds[0] !== "pcb" && kinds[0] !== "schematic")) {
    return new Response(null, { status: 400, headers: privateHeaders });
  }
  const viewer = await viewerAuthorization();
  if (!viewer.session) return new Response(null, { status: 401, headers: privateHeaders });

  try {
    // Reuse the exact Run page's repository authorization (including refreshed
    // GitHub App grants for private repositories), rather than trusting a run ID.
    const result = await loadRunDashboard(
      runId,
      process.env,
      {},
      {
        ...runDashboardLoaderDependencies,
        authorizeRepository: viewer.authorizeRepository,
      },
    );
    if (result.state === "not-found") return new Response(null, { status: 404, headers: privateHeaders });
    if (result.state === "not-configured") return new Response(null, { status: 503, headers: privateHeaders });
    const kind = kinds[0] === "pcb" ? "pcb_layer" : "schematic";
    const svg = await loadRunNativeDesignPreview(runId, result.run.repositoryId, kind);
    if (!svg) return new Response(null, { status: 404, headers: privateHeaders });
    return new Response(svg, {
      status: 200,
      headers: {
        ...privateHeaders,
        "Content-Type": "image/svg+xml; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "Cross-Origin-Resource-Policy": "same-origin",
        "Content-Security-Policy": "sandbox; default-src 'none'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return new Response(null, { status: 503, headers: privateHeaders });
  }
}
