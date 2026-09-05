import { ThemeProvider } from "next-themes";
import type { ReactNode } from "react";
import { ProductNavigation } from "./product-navigation.js";

/**
 * `viewerNav` is a slot rather than something AppShell imports itself. Error boundaries are
 * client components and also render this shell, so importing the session reader here would
 * pull `next/headers` into a client bundle and fail the build.
 */
export function AppShell({ children, viewerNav }: Readonly<{ children: ReactNode; viewerNav?: ReactNode }>) {
  return (
    <ThemeProvider attribute="class" defaultTheme="dark" enableSystem={false}>
      <div className="flex min-h-dvh bg-background text-foreground">
        <a
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2"
          href="#main-content"
        >
          Skip to main content
        </a>
        <ProductNavigation viewerNav={viewerNav} />
        <div className="flex flex-1 flex-col">
          <header className="flex items-center gap-3 border-b border-border px-6 py-3">
            <span className="text-sm font-bold text-foreground">BoardReadyOps Cloud</span>
            <span className="text-xs uppercase tracking-wide text-muted-foreground">Engineering operations</span>
          </header>
          {children}
          <footer className="mt-auto border-t border-border px-6 py-4 text-sm text-muted-foreground">
            <p>
              BoardReadyOps checks whether a board is ready to fabricate. Your repository and its full workflow logs
              stay the source of truth.
            </p>
          </footer>
        </div>
      </div>
    </ThemeProvider>
  );
}
