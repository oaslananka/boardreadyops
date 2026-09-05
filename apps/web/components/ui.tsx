import Link from "next/link";
import type { ReactNode } from "react";
import { AlertDescription, AlertRoot, AlertTitle } from "./ui/alert.js";
import { Badge } from "./ui/badge.js";
import { Button } from "./ui/button.js";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card.js";

export { AppShell } from "./app-shell.js";

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

const badgeVariantByTone: Record<StatusTone, "danger" | "success" | "warning" | "info" | "secondary"> = {
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
  neutral: "secondary",
};

export function StatusBadge({ value, label }: Readonly<{ value: string | undefined; label?: string }>) {
  const tone = statusTone(value);
  return (
    <Badge variant={badgeVariantByTone[tone]} className={`text-${tone === "neutral" ? "muted-foreground" : tone}`}>
      {label ?? humanize(value)}
    </Badge>
  );
}

export type BreadcrumbItem = { href?: string; label: string };

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

export type PanelTone = "default" | "raised" | "inset" | "critical" | "section";

export type PanelProps = {
  children: ReactNode;
  title: string;
  description?: string;
  actions?: ReactNode;
  id?: string;
  tone?: PanelTone;
};

const panelToneClass: Record<PanelTone, string> = {
  default: "",
  raised: "shadow-lg",
  inset: "bg-muted",
  critical: "border-danger/50",
  section: "border-dashed",
};

export function Panel({ children, title, description, actions, id, tone = "default" }: Readonly<PanelProps>) {
  const headingId = id ? `${id}-heading` : undefined;
  return (
    <Card id={id} className={panelToneClass[tone]} aria-labelledby={headingId}>
      <CardHeader>
        <div>
          <CardTitle id={headingId}>{title}</CardTitle>
          {description ? <CardDescription>{description}</CardDescription> : null}
        </div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </CardHeader>
      <CardContent>{children}</CardContent>
    </Card>
  );
}

export function DefinitionGrid({ children }: Readonly<{ children: ReactNode }>) {
  return <dl className="grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">{children}</dl>;
}

export function Definition({ label, children }: Readonly<{ label: string; children: ReactNode }>) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-sm text-foreground">{children}</dd>
    </div>
  );
}

const alertVariantByTone: Record<StatusTone, "default" | "danger" | "success" | "warning" | "info"> = {
  danger: "danger",
  success: "success",
  warning: "warning",
  info: "info",
  neutral: "default",
};

export function Alert({
  children,
  title,
  tone = "info",
}: Readonly<{ children: ReactNode; title: string; tone?: StatusTone }>) {
  return (
    <AlertRoot
      variant={alertVariantByTone[tone]}
      role={tone === "danger" ? "alert" : undefined}
      aria-live={tone === "danger" ? undefined : "polite"}
    >
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>{children}</AlertDescription>
    </AlertRoot>
  );
}

export function EmptyState({
  title,
  children,
  action,
}: Readonly<{ title: string; children: ReactNode; action?: ReactNode }>) {
  return (
    <Card className="flex flex-col items-center gap-3 border-dashed px-6 py-10 text-center">
      <h3 className="text-base font-bold text-foreground">{title}</h3>
      <div className="text-sm text-muted-foreground">{children}</div>
      {action ? <div className="mt-2">{action}</div> : null}
    </Card>
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
    <nav aria-label="Pagination" className="flex items-center justify-between gap-4">
      {page > 1 ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page - 1)} rel="prev">
            Previous
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-disabled="true">
          Previous
        </Button>
      )}
      <span aria-live="polite" className="text-sm text-muted-foreground">
        Page <strong className="text-foreground">{page}</strong> of{" "}
        <strong className="text-foreground">{totalPages}</strong>
      </span>
      {page < totalPages ? (
        <Button asChild variant="outline" size="sm">
          <Link href={href(page + 1)} rel="next">
            Next
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-disabled="true">
          Next
        </Button>
      )}
    </nav>
  );
}
