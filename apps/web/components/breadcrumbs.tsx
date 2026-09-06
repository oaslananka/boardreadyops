import Link from "next/link";

export type BreadcrumbItem = { href?: string; label: string };

/**
 * Lives here rather than in `components/ui.tsx` because `AppShell` renders it in the topbar and
 * `ui.tsx` re-exports `AppShell` — importing back the other way would be a cycle. `ui.tsx` still
 * re-exports `Breadcrumbs` and `BreadcrumbItem`, so nothing else had to change.
 */
export function Breadcrumbs({ items }: Readonly<{ items: BreadcrumbItem[] }>) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
      <ol className="flex flex-wrap items-center gap-1.5">
        {items.map((item, index) => (
          <li key={`${item.href ?? "current"}:${item.label}`} className="flex items-center gap-1.5">
            {index > 0 ? <span aria-hidden="true">/</span> : null}
            {item.href ? (
              <Link href={item.href} className="hover:text-foreground hover:underline">
                {item.label}
              </Link>
            ) : (
              <span aria-current="page" className="font-medium text-foreground">
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
