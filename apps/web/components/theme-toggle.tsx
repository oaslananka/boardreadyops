"use client";

/**
 * Switches the ledger between ink and paper.
 *
 * The stylesheet already answers the reader's system preference on its own, so this exists for
 * the reader whose system says one thing and who wants the other. A choice is written to
 * localStorage and replayed by the inline script in the root layout before first paint, which
 * is what keeps the page from flashing the wrong ground on the way in.
 *
 * Which icon shows is decided in CSS from the same tokens the theme itself uses, not from
 * state read during render. A button whose contents depend on localStorage cannot be rendered
 * identically on the server, and rendering it differently is a hydration mismatch; letting the
 * stylesheet answer means there is nothing to mismatch. For the same reason the label names the
 * axis rather than the destination, so it stays true in both directions.
 */
// The DOM library is not in scope for this package, so browser globals are reached through a
// narrow cast the way run-live-refresh.tsx already does it.
type BrowserGlobals = typeof globalThis & {
  document: {
    documentElement: { getAttribute(name: string): string | null; setAttribute(name: string, value: string): void };
  };
  window: { matchMedia(query: string): { matches: boolean } };
  localStorage: { setItem(key: string, value: string): void };
};

function toggleTheme(): void {
  const browser = globalThis as BrowserGlobals;
  const root = browser.document.documentElement;
  const current =
    root.getAttribute("data-theme") ??
    (browser.window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const next = current === "light" ? "dark" : "light";
  root.setAttribute("data-theme", next);
  try {
    browser.localStorage.setItem("boardreadyops-theme", next);
  } catch {
    // A browser that refuses storage still gets the switch, just not the memory of it.
  }
}

export function ThemeToggle() {
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label="Switch between light and dark"
      title="Switch between light and dark"
      onClick={toggleTheme}
    >
      <svg className="theme-icon theme-icon-sun" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <circle cx="12" cy="12" r="4.2" />
        <path d="M12 2.6v2.6M12 18.8v2.6M2.6 12h2.6M18.8 12h2.6M5.3 5.3l1.9 1.9M16.8 16.8l1.9 1.9M18.7 5.3l-1.9 1.9M7.2 16.8l-1.9 1.9" />
      </svg>
      <svg className="theme-icon theme-icon-moon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d="M20 14.2A8.2 8.2 0 0 1 9.8 4a8.4 8.4 0 1 0 10.2 10.2z" />
      </svg>
    </button>
  );
}
