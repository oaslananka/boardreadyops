import { type ReactNode, Suspense } from "react";
import { type BreadcrumbItem, Breadcrumbs } from "./breadcrumbs.js";
import { CommandPalette } from "./ui/command-palette.js";

/**
 * The topbar the shell used to fake with two static text spans.
 *
 * Breadcrumbs are hoisted here from the pages rather than derived from `usePathname`: a
 * segment-to-title map would be a second route inventory to keep in sync with `qa/audit/routes.ts`,
 * and hand-written labels read better ("Run: Findings", not "Findings").
 */
export function AppTopbar({
  breadcrumbs,
  viewerNav,
}: Readonly<{ breadcrumbs?: readonly BreadcrumbItem[]; viewerNav?: ReactNode }>) {
  return (
    <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-border bg-background/85 px-4 py-2 backdrop-blur-sm md:gap-3 md:px-6">
      {/* Room for the drawer trigger, which is position-fixed at the same corner on mobile. */}
      <div className="w-10 shrink-0 md:hidden" aria-hidden="true" />
      {/*
        On a phone only the current crumb fits; the ancestors come back as soon as there is room.
        Hiding them in CSS also keeps them out of the accessibility tree at that width, which is
        the right answer -- a three-line wrapped trail is not useful to anyone.
      */}
      <div className="min-w-0 flex-1 overflow-hidden [&_li:not(:last-child)]:hidden sm:[&_li:not(:last-child)]:flex">
        {breadcrumbs && breadcrumbs.length > 0 ? <Breadcrumbs items={[...breadcrumbs]} /> : null}
      </div>
      <div className="flex min-w-0 shrink items-center justify-end gap-2 sm:flex-1 sm:max-w-80">
        <CommandPalette />
      </div>
      {viewerNav ? <Suspense fallback={null}>{viewerNav}</Suspense> : null}
    </header>
  );
}
