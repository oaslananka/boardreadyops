import type { ReactNode } from "react";
import { ProductNavigation } from "./product-navigation.js";

/**
 * `viewerNav` is a slot rather than something AppShell imports itself. Error boundaries are
 * client components and also render this shell, so importing the session reader here would
 * pull `next/headers` into a client bundle and fail the build.
 */
export function AppShell({ children, viewerNav }: Readonly<{ children: ReactNode; viewerNav?: ReactNode }>) {
  return (
    <div className="product-shell">
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <ProductNavigation viewerNav={viewerNav} />
      <div className="product-stage">
        <header className="product-context-bar">
          <span className="product-context-product">BoardReadyOps Cloud</span>
          <span className="context-kicker">Engineering operations</span>
        </header>
        {children}
        <footer className="site-footer">
          <p>
            BoardReadyOps checks whether a board is ready to fabricate. Your repository and its full workflow logs stay
            the source of truth.
          </p>
        </footer>
      </div>
    </div>
  );
}
