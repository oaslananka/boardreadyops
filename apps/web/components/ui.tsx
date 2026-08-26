import Link from "next/link";
import { type ReactNode, Suspense } from "react";
import { BrandMarkLockup } from "./brand-mark.js";

export type StatusTone = "danger" | "info" | "neutral" | "success" | "warning";

const dangerValues = new Set([
  "blocked",
  "critical",
  "dead_letter",
  "error",
  "expired",
  "fail",
  "failed",
  "failure",
  "high",
  "timed_out",
  "unauthorized",
]);
const successValues = new Set(["available", "completed", "deleted", "pass", "passed", "ready", "success"]);
const warningValues = new Set([
  "medium",
  "metadata-only",
  "missing",
  "partial_data",
  "reconciliation",
  "stale",
  "waived",
  "warning",
]);
const infoValues = new Set([
  "accepted",
  "dispatching",
  "in_progress",
  "leased",
  "processing",
  "queued",
  "reporting",
  "running",
]);

export function humanize(value: string | undefined): string {
  if (!value) return "Unknown";
  return value
    .replaceAll("_", " ")
    .replaceAll("-", " ")
    .replace(/\b\w/gu, (letter) => letter.toUpperCase());
}

export function statusTone(value: string | undefined): StatusTone {
  const normalized = value?.toLowerCase() ?? "";
  if (dangerValues.has(normalized)) return "danger";
  if (successValues.has(normalized)) return "success";
  if (warningValues.has(normalized)) return "warning";
  if (infoValues.has(normalized)) return "info";
  return "neutral";
}

function statusIconPath(tone: StatusTone): string {
  switch (tone) {
    case "success":
      return "M5 12.5 9.5 17 19 7.5";
    case "danger":
      return "M12 7v6m0 4h.01";
    case "warning":
      return "M12 8v5m0 3h.01";
    case "info":
      return "M12 8h.01M11 12h1v5h1";
    default:
      return "M7 12h10";
  }
}

function StatusIcon({ tone }: Readonly<{ tone: StatusTone }>) {
  const path = statusIconPath(tone);
  return (
    <svg aria-hidden="true" className="status-icon" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="9" />
      <path d={path} />
    </svg>
  );
}

export function StatusBadge({ value, label }: Readonly<{ value: string | undefined; label?: string }>) {
  const tone = statusTone(value);
  return (
    <span className="status-badge" data-tone={tone}>
      <StatusIcon tone={tone} />
      <span>{label ?? humanize(value)}</span>
    </span>
  );
}

/**
 * `viewerNav` is a slot rather than something AppShell imports itself. Error boundaries are
 * client components and also render this shell, so importing the session reader here would
 * pull `next/headers` into a client bundle and fail the build.
 */
export function AppShell({ children, viewerNav }: Readonly<{ children: ReactNode; viewerNav?: ReactNode }>) {
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to main content
      </a>
      <header className="site-header">
        <div className="site-header-inner">
          <Link className="brand" href="/" aria-label="BoardReadyOps home">
            <BrandMarkLockup size={24} className="brand-lockup" />
          </Link>
          <nav className="site-navigation" aria-label="Global navigation">
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/setup">Repository setup</Link>
            <Link href="/settings/component-intelligence">Component intelligence</Link>
            <a href="https://docs.boardreadyops.com">Documentation</a>
            {viewerNav ? <Suspense fallback={null}>{viewerNav}</Suspense> : null}
          </nav>
        </div>
      </header>
      {children}
      <footer className="site-footer">
        <p>
          BoardReadyOps checks whether a board is ready to fabricate. Your repository and its full workflow logs stay
          the source of truth.
        </p>
      </footer>
    </>
  );
}

export type BreadcrumbItem = { href?: string; label: string };

export function Breadcrumbs({ items }: Readonly<{ items: BreadcrumbItem[] }>) {
  return (
    <nav className="breadcrumbs" aria-label="Breadcrumb">
      <ol>
        {items.map((item) => (
          <li key={`${item.href ?? "current"}:${item.label}`}>
            {item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Panel({
  children,
  title,
  description,
  actions,
  id,
}: Readonly<{
  children: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  id?: string;
}>) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <section className="panel" id={id} aria-labelledby={headingId}>
      <header className="panel-header">
        <div>
          <h2 id={headingId}>{title}</h2>
          {description ? <p>{description}</p> : null}
        </div>
        {actions ? <div className="panel-actions">{actions}</div> : null}
      </header>
      {children}
    </section>
  );
}

export function DefinitionGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className="definition-grid">{children}</dl>;
}

export function Definition({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

export function Alert({
  children,
  title,
  tone = "info",
}: Readonly<{ children: ReactNode; title: string; tone?: StatusTone }>) {
  return (
    <section
      className="alert"
      data-tone={tone}
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "danger" ? undefined : "polite"}
    >
      <StatusIcon tone={tone} />
      <div>
        <h2>{title}</h2>
        <div>{children}</div>
      </div>
    </section>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return (
    <div className="empty-state">
      <svg aria-hidden="true" viewBox="0 0 48 48">
        <path d="M10 13h28v25H10zM16 8h16v5H16zM17 21h14M17 28h10" />
      </svg>
      <h3>{title}</h3>
      <div>{children}</div>
      {action ? <div className="empty-state-action">{action}</div> : null}
    </div>
  );
}

export function Pagination({
  basePath,
  page,
  totalPages,
  pageParameter,
  searchParameters,
}: Readonly<{
  basePath: string;
  page: number;
  totalPages: number;
  pageParameter: string;
  searchParameters: Readonly<Record<string, string | undefined>>;
}>) {
  if (totalPages <= 1) return null;

  function href(target: number): string {
    const parameters = new URLSearchParams();
    for (const [name, value] of Object.entries(searchParameters)) {
      if (value) parameters.set(name, value);
    }
    parameters.set(pageParameter, String(target));
    return `${basePath}?${parameters.toString()}`;
  }

  return (
    <nav className="pagination" aria-label="Pagination">
      {page > 1 ? (
        <Link className="button button-secondary" href={href(page - 1)} rel="prev">
          Previous
        </Link>
      ) : (
        <span className="button button-secondary" aria-disabled="true">
          Previous
        </span>
      )}
      <span aria-live="polite">
        Page <strong>{page}</strong> of <strong>{totalPages}</strong>
      </span>
      {page < totalPages ? (
        <Link className="button button-secondary" href={href(page + 1)} rel="next">
          Next
        </Link>
      ) : (
        <span className="button button-secondary" aria-disabled="true">
          Next
        </span>
      )}
    </nav>
  );
}
