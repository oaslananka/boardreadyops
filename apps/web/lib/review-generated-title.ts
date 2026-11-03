/**
 * Older Review rows can retain the first automatically generated SHA title even
 * after a newer verified revision becomes current. This is display-only: do not
 * rewrite human-entered titles or mutate stored Review records.
 */
export function resolvedReviewTitle(title: string, currentHeadSha: string | undefined): string {
  return /^Review for [0-9a-f]{8}$/u.test(title) && currentHeadSha && /^[0-9a-f]{40}$/u.test(currentHeadSha)
    ? `Review for ${currentHeadSha.slice(0, 8)}`
    : title;
}
