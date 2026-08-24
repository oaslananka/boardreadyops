import { sessionCookieName } from "../../../../lib/viewer-authorization.js";

export const runtime = "nodejs";

/**
 * Ends the browser session.
 *
 * POST only: a GET would let a third-party page sign the viewer out by embedding a link.
 */
export async function POST(): Promise<Response> {
  return new Response(null, {
    status: 302,
    headers: new Headers([
      ["location", "/"],
      ["set-cookie", `${sessionCookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`],
    ]),
  });
}
