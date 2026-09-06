import type { ProductIconName } from "./product-icons.js";

export type NavigationItem = Readonly<{
  href: string;
  icon: ProductIconName;
  label: string;
}>;

export type NavigationGroup = Readonly<{ label: string; items: readonly NavigationItem[] }>;

/**
 * The single source of truth for product destinations, shared by the sidebar rail and the
 * command palette so the two can never drift.
 *
 * Grouped by task sequence rather than category, per ADR-0016: a first-time user is told what
 * order the work happens in instead of being asked to guess which category a task belongs to.
 */
export const navigationGroups: readonly NavigationGroup[] = [
  {
    label: "1. Get a board in",
    items: [
      { label: "Projects", href: "/projects", icon: "projects" },
      { label: "Setup", href: "/setup", icon: "setup" },
    ],
  },
  {
    label: "2. Work the findings",
    items: [
      { label: "My Work", href: "/work", icon: "work" },
      { label: "Reviews", href: "/reviews", icon: "reviews" },
    ],
  },
  {
    label: "3. Ship it",
    items: [
      { label: "Deliveries", href: "/deliveries", icon: "deliveries" },
      { label: "Parts", href: "/parts", icon: "parts" },
    ],
  },
  {
    label: "Govern",
    items: [
      { label: "Policies", href: "/policies", icon: "policies" },
      { label: "Evidence", href: "/evidence", icon: "evidence" },
      { label: "Insights", href: "/insights", icon: "insights" },
    ],
  },
  {
    label: "Workspace",
    items: [{ label: "Settings", href: "/settings/billing", icon: "settings" }],
  },
] as const;

export const dashboardItem: NavigationItem = { label: "Dashboard", href: "/dashboard", icon: "projects" };

/** Flat destination list for the command palette, dashboard first. */
export const navigationDestinations: readonly (NavigationItem & { group: string })[] = [
  { ...dashboardItem, group: "Go to" },
  ...navigationGroups.flatMap((group) => group.items.map((item) => ({ ...item, group: group.label }))),
];

export function isCurrentRoute(pathname: string | null | undefined, href: string): boolean {
  if (!pathname) return false;
  // Settings is one nav entry pointing at its first tab, so every /settings/* child keeps it lit.
  if (href === "/settings/billing") return pathname.startsWith("/settings/");
  return pathname === href || pathname.startsWith(`${href}/`);
}
