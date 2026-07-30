# Accessibility

BoardReadyOps targets WCAG 2.1 AA for human-facing HTML surfaces that are generated or hosted by this repository.

## Scope

In scope:

- The standalone HTML report emitted by `report.html`.
- The hosted Next.js run investigation under `/runs/<runId>`.
- The MkDocs documentation site generated from `docs/` and `mkdocs.yml`.

Out of scope:

- Markdown rendered by GitHub, because GitHub controls the final HTML.
- SARIF rendered by GitHub Code Scanning, because GitHub controls the final UI.
- Terminal output, which follows the host terminal and screen reader behavior.

## Target Criteria

The required AA criteria are:

- 1.4.3 Contrast (Minimum): text contrast is at least 4.5:1.
- 1.4.11 Non-text Contrast: UI component contrast is at least 3:1.
- 2.1.1 Keyboard: interactive controls are reachable by keyboard.
- 2.4.3 Focus Order: focus order follows the visual and document flow.
- 2.4.7 Focus Visible: keyboard focus remains visible.
- 3.3.2 Labels or Instructions: controls expose visible labels or instructions.
- 4.1.2 Name, Role, Value: controls expose useful native semantics or ARIA metadata.

## Automated Checks

The HTML report is checked with axe-core in `tests/unit/report/html.test.ts`. The test renders the standalone
report in a DOM environment and runs the WCAG A and AA rulesets against the static report shell.


### Hosted run investigation

The hosted run investigation uses one shared token and component system for summary, attempts, findings, artifacts,
publication, and audit routes. Status and severity always include a visible text label and an icon; color is additional
context only. Keyboard users receive a skip link, visible focus indicators, native labeled form controls, route-level
navigation, and reduced-motion behavior.

Finding and artifact views use server-side, parameterized filtering and bounded pagination. Large tables remain inside a
responsive overflow region, checksums have an explicit copy control, and empty, loading, stale, reconciliation, failed,
unauthorized, expired, and unavailable states use consistent action-oriented copy.

`tests/unit/web/run-investigation-accessibility.test.ts` renders the primary investigation shell and runs axe-core WCAG A
and AA rules. Its component snapshot provides structural visual-regression coverage. The design-token and contrast
contract is pinned by `tests/unit/web/run-design-system.test.ts`; route and state coverage is pinned by
`tests/unit/web/run-dashboard-page.test.ts`.

The MkDocs site is checked with pa11y through:

```bash
corepack pnpm run docs:a11y
```

The check builds the strict MkDocs site, scans generated HTML pages with the axe and htmlcs pa11y runners, and fails
on WCAG2AA errors. The CI accessibility job runs the combined gate:

```bash
corepack pnpm run test:a11y
```

## Manual Review

Automated tools do not prove full conformance. Before large layout changes, manually verify keyboard navigation,
focus visibility, and reading order in the generated HTML report and a local MkDocs build. Document any intentional
exception in this file with the affected surface, criterion, reason, and follow-up issue.
