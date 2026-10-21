/**
 * Bounded, URL-owned back-stack for keyset pagination.
 *
 * Each entry is the cursor used to enter the previous page; an empty string
 * represents page one. No server session or cross-viewer pagination state is
 * persisted. Untrusted URL state is parsed and bounded before use.
 */
const MAX_HISTORY_ENTRIES = 20;
const MAX_HISTORY_QUERY_LENGTH = 16384;
const MAX_CURSOR_LENGTH = 512;

function decodeHistory(raw: string | undefined): string[] {
  if (!raw || raw.length > MAX_HISTORY_QUERY_LENGTH) return [];
  try {
    const value: unknown = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    if (
      !Array.isArray(value) ||
      value.length > MAX_HISTORY_ENTRIES ||
      !value.every(
        (entry): entry is string =>
          typeof entry === "string" && entry.length <= MAX_CURSOR_LENGTH && /^[a-zA-Z0-9_-]*$/u.test(entry),
      )
    ) {
      return [];
    }
    return value;
  } catch {
    return [];
  }
}

function runsHref(cursor: string | undefined, history: readonly string[], limit: number): string {
  const query = new URLSearchParams({ limit: String(limit) });
  if (cursor) query.set("cursor", cursor);
  if (history.length > 0) query.set("back", Buffer.from(JSON.stringify(history)).toString("base64url"));
  return `/runs?${query.toString()}`;
}

/** The current cursor has already been verified by decodeRunListingCursor. */
export function buildRunPaginationLinks({
  cursor,
  back,
  next,
  limit,
}: Readonly<{ cursor?: string | undefined; back?: string | undefined; next?: string | undefined; limit: number }>): {
  previousHref: string | undefined;
  nextHref: string | undefined;
} {
  const history = cursor ? decodeHistory(back) : [];
  const previousCursor = history.at(-1);
  const previousHref =
    previousCursor === undefined ? undefined : runsHref(previousCursor || undefined, history.slice(0, -1), limit);
  const nextHistory = [...history, cursor ?? ""].slice(-MAX_HISTORY_ENTRIES);
  const nextHref = next ? runsHref(next, nextHistory, limit) : undefined;
  return { previousHref, nextHref };
}
