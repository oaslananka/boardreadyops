import type { Metadata } from "next";
import Link from "next/link";
import { AppShell } from "../../components/app-shell.js";
import { Button } from "../../components/ui/button.js";
import { type DataColumn, DataTable } from "../../components/ui/data-table.js";
import { Input } from "../../components/ui/input.js";
import { NativeSelect } from "../../components/ui/native-select.js";
import { EmptyState, Panel, StatusBadge } from "../../components/ui.js";
import { ViewerNav } from "../../components/viewer-nav.js";
import {
  type CatalogRule,
  catalogRules,
  filterRules,
  parseRuleCategory,
  parseRuleSeverity,
  ruleCountsByCategory,
} from "../../lib/rule-catalog.js";

export const metadata: Metadata = {
  title: "Rule Catalogue",
  description: "Every fabrication-readiness rule BoardReadyOps runs, what it checks, and why.",
};

export type RulesPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function first(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

const categoryLabels: Record<string, string> = {
  electrical: "Electrical",
  manufacturability: "Manufacturability",
  assembly: "Assembly",
  testability: "Testability",
  sourcing: "Sourcing",
  release: "Release",
  unclassified: "Unclassified",
};

const columns: readonly DataColumn<CatalogRule>[] = [
  {
    id: "rule",
    header: "Rule",
    rowHeader: true,
    cell: (rule) => (
      <span className="flex flex-col gap-0.5">
        <span className="font-medium text-foreground">{rule.title}</span>
        <span className="font-mono text-meta text-muted-foreground break-all">{rule.id}</span>
      </span>
    ),
  },
  {
    id: "severity",
    header: "Default severity",
    cell: (rule) => <StatusBadge value={rule.defaultSeverity} />,
  },
  {
    id: "category",
    header: "Category",
    cell: (rule) => <span>{categoryLabels[rule.category] ?? rule.category}</span>,
  },
  {
    id: "applies",
    header: "Applies to",
    cell: (rule) => <span className="text-muted-foreground">{rule.appliesTo.join(", ")}</span>,
  },
  {
    id: "why",
    header: "Why it matters",
    cell: (rule) => <span className="break-words text-muted-foreground">{rule.rationale}</span>,
  },
];

export default async function RulesPage({ searchParams }: Readonly<RulesPageProps>) {
  const parameters = await searchParams;
  const query = first(parameters.q)?.slice(0, 128);
  const category = parseRuleCategory(first(parameters.category));
  const severity = parseRuleSeverity(first(parameters.severity));

  const rules = filterRules({ query, category, severity });
  const counts = ruleCountsByCategory();
  const filtered = Boolean(query || category || severity);

  return (
    <AppShell viewerNav={<ViewerNav />} breadcrumbs={[{ href: "/dashboard", label: "Dashboard" }, { label: "Rules" }]}>
      <main id="main-content" className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-6 py-8">
        <header>
          <h1 className="text-2xl font-bold text-foreground">Rule Catalogue</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            All {catalogRules.length} checks BoardReadyOps runs against a hardware project, with the default severity
            each carries and the reason it exists. Severity and gating are configured per repository in{" "}
            <code className="font-mono">boardreadyops.yml</code>.
          </p>
        </header>

        <Panel title="Checks" description={`${rules.length} of ${catalogRules.length} shown, most severe first.`}>
          {/* A plain GET form: filtering works without JavaScript, and the URL is what someone
              pastes into a ticket to point at a specific check. */}
          <form method="get" action="/rules" className="mb-4 flex flex-wrap items-end gap-3">
            <label className="flex min-w-0 flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Search</span>
              <Input
                name="q"
                type="search"
                maxLength={128}
                defaultValue={query}
                placeholder="Rule, tag, or config key"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Category</span>
              <NativeSelect name="category" defaultValue={category ?? ""}>
                <option value="">Any</option>
                {[...counts.entries()]
                  .sort(([left], [right]) => left.localeCompare(right))
                  .map(([value, count]) => (
                    <option key={value} value={value}>
                      {categoryLabels[value] ?? value} ({count})
                    </option>
                  ))}
              </NativeSelect>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-xs text-muted-foreground">Default severity</span>
              <NativeSelect name="severity" defaultValue={severity ?? ""}>
                <option value="">Any</option>
                <option value="critical">Critical</option>
                <option value="high">High</option>
                <option value="medium">Medium</option>
                <option value="low">Low</option>
                <option value="info">Info</option>
              </NativeSelect>
            </label>
            <Button type="submit" variant="outline">
              Apply
            </Button>
            {filtered ? (
              <Button asChild variant="ghost">
                <Link href="/rules">Clear</Link>
              </Button>
            ) : null}
          </form>

          <DataTable
            caption="Fabrication readiness rules, most severe first"
            columns={columns}
            rows={rules}
            rowKey={(rule) => rule.id}
            empty={
              <EmptyState title="No rules match these filters">
                <p>Widen the search, or clear the filters to see every check.</p>
                <Button asChild variant="outline" className="mt-3">
                  <Link href="/rules">Clear filters</Link>
                </Button>
              </EmptyState>
            }
          />
        </Panel>
      </main>
    </AppShell>
  );
}
