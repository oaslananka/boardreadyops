/**
 * Naming a touch-target finding.
 *
 * Its own module, DOM-free on purpose: `checks.ts` is full of Playwright and browser code, and
 * importing it from a Node test drags `document` and `window` into a program that has no `dom`
 * lib. This half needs neither -- it takes plain strings the page already collected and decides
 * what to call the control -- so it lives where both the audit and a unit test can reach it.
 */

/** What the page can tell us about one candidate control. Facts only -- no verdict. */
export type TouchTargetCandidate = {
  ariaLabel: string;
  labelledByText: string;
  text: string;
  title: string;
  tag: string;
  width: number;
  height: number;
  /** Whether a tap anywhere in the required box is routed to this control. */
  reachable: boolean;
};

/** The longest a finding may be before it stops fitting on one line of the report. */
const maxNameLength = 40;

/**
 * The accessible name as a checker would resolve it, so a finding names a real control rather
 * than falling back to its tag.
 *
 * The `aria-labelledby` step matters more than it looks: a control whose name comes entirely
 * from a sibling element was reported as `"BUTTON"` without it, which is nearly useless when the
 * control renders client-side only and never appears in the served HTML.
 */
export function touchTargetName(candidate: TouchTargetCandidate): string {
  const name = candidate.ariaLabel || candidate.labelledByText || candidate.text || candidate.title || candidate.tag;
  return name.slice(0, maxNameLength);
}
