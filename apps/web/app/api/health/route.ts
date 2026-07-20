import { GET as getLiveness } from "./live/route.js";

export const runtime = "nodejs";

export function GET(): Response {
  return getLiveness();
}
