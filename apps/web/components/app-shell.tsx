import type { ReactNode } from "react";
import { AppTopbar } from "./app-topbar.js";
import type { BreadcrumbItem } from "./breadcrumbs.js";
import { ProductNavigation } from "./product-navigation.js";
import { ToastProvider } from "./ui/toast.js";

/**
 * `viewerNav` is a slot rather than something AppShell imports itself. Error boundaries are
 * client components and also render this shell, so importing the session reader here would
 * pull `next/headers` into a client bundle and fail the build.
 *
 * `breadcrumbs` is a prop rather than something each page renders inline, because the trail now
 * lives in the topbar. Pages pass their items up; the `Breadcrumbs` component itself is
 * unchanged.
 *
 * There is no ThemeProvider here — app/layout.tsx mounts the single one for the whole tree. A
 * second one raced it over the same storage key and class.
 */
export function AppShell({
  children,
  viewerNav,
  breadcrumbs,
}: Readonly<{ children: ReactNode; viewerNav?: ReactNode; breadcrumbs?: readonly BreadcrumbItem[] }>) {
  return (
    <ToastProvider>
      <div className="flex min-h-dvh bg-background text-foreground">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          href="#main-content"
        >
          Skip to main content
        </a>
        <ProductNavigation />
        <div className="flex min-w-0 flex-1 flex-col">
          <AppTopbar {...(breadcrumbs ? { breadcrumbs } : {})} {...(viewerNav ? { viewerNav } : {})} />
          {children}
          <footer className="mt-auto border-t border-border px-6 py-4 text-sm text-muted-foreground">
            <p>
              BoardReadyOps checks whether a board is ready to fabricate. Your repository and its full workflow logs
              stay the source of truth.
            </p>
          </footer>
        </div>
      </div>
    </ToastProvider>
  );
}
