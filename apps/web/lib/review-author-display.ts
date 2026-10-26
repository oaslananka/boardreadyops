/** An opaque creator id is not a displayable identity. Never leak it in tooltips. */
export function displayReviewAuthor(value: string): string {
  if (/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/iu.test(value)) return "Recorded member";
  return value || "Unknown creator";
}
