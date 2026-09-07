import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "../../lib/utils.js";
import { Button } from "./button.js";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "./table.js";

export type SortDirection = "asc" | "desc";

export type DataColumn<Row> = {
  readonly id: string;
  readonly header: string;
  readonly cell: (row: Row) => ReactNode;
  readonly sortable?: boolean;
  readonly align?: "start" | "end";
  /** Merged onto the cell, so pages keep the class hooks the E2E suite binds to. */
  readonly className?: string;
  readonly headerClassName?: string;
  /** Render this column's cells as `<th scope="row">` — the row's own label. At most one. */
  readonly rowHeader?: boolean;
};

export type DataTableSort = { readonly column: string; readonly direction: SortDirection };

type SearchParameters = Readonly<Record<string, string | undefined>>;

function hrefWith(basePath: string, searchParameters: SearchParameters, overrides: SearchParameters): string {
  const parameters = new URLSearchParams();
  for (const [name, value] of Object.entries({ ...searchParameters, ...overrides })) {
    if (value) parameters.set(name, value);
  }
  const query = parameters.toString();
  return query ? `${basePath}?${query}` : basePath;
}

/**
 * A server-rendered table whose sort and filter state lives entirely in the URL.
 *
 * URL state rather than client state, for three reasons that all already hold in this codebase:
 * `lib/run-listing.ts` paginates on the server with a keyset cursor, so a client table would
 * have to load every row before it could sort; `run-investigation.tsx` already drives its
 * findings filters through a GET form and `searchParams`; and `tests/e2e/tabs-contract.spec.ts`
 * establishes deep-linkable, back/forward-able URL state as the house contract. It also means
 * sorting works with JavaScript disabled.
 */
export function DataTable<Row>({
  columns,
  rows,
  rowKey,
  caption,
  tableId,
  basePath = "",
  searchParameters = {},
  sort,
  sortParameter = "sort",
  directionParameter = "dir",
  empty,
}: Readonly<{
  columns: readonly DataColumn<Row>[];
  rows: readonly Row[];
  rowKey: (row: Row) => string;
  /** Screen-reader caption. Required: axe wants every data table to announce what it holds. */
  caption: string;
  tableId?: string;
  /** Only needed when a column is `sortable`; sort links are built from it. */
  basePath?: string;
  searchParameters?: SearchParameters;
  sort?: DataTableSort | undefined;
  sortParameter?: string;
  directionParameter?: string;
  empty: ReactNode;
}>) {
  if (rows.length === 0) return <>{empty}</>;

  return (
    <Table scrollLabel={caption} {...(tableId ? { id: tableId } : {})}>
      <TableCaption>{caption}</TableCaption>
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {columns.map((column) => {
            const active = sort?.column === column.id;
            const nextDirection: SortDirection = active && sort?.direction === "asc" ? "desc" : "asc";
            const ariaSort = active ? (sort?.direction === "asc" ? "ascending" : "descending") : "none";
            return (
              <TableHead
                key={column.id}
                scope="col"
                aria-sort={column.sortable ? ariaSort : undefined}
                className={cn(column.align === "end" && "text-right", column.headerClassName)}
              >
                {column.sortable ? (
                  <Link
                    href={hrefWith(basePath, searchParameters, {
                      [sortParameter]: column.id,
                      [directionParameter]: nextDirection,
                    })}
                    className="inline-flex items-center gap-1 rounded-sm text-inherit outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
                  >
                    {column.header}
                    <span aria-hidden="true" className={cn("text-[0.85em]", active ? "text-primary" : "opacity-40")}>
                      {active && sort?.direction === "desc" ? "↓" : "↑"}
                    </span>
                  </Link>
                ) : (
                  column.header
                )}
              </TableHead>
            );
          })}
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={rowKey(row)}>
            {columns.map((column) =>
              column.rowHeader ? (
                <TableCell
                  key={column.id}
                  asChild
                  className={cn("font-medium", column.align === "end" && "text-right", column.className)}
                >
                  <th scope="row" className="text-left">
                    {column.cell(row)}
                  </th>
                </TableCell>
              ) : (
                <TableCell key={column.id} className={cn(column.align === "end" && "text-right", column.className)}>
                  {column.cell(row)}
                </TableCell>
              ),
            )}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

/**
 * Prev/next for keyset-paginated listings, where total pages are unknown by design.
 *
 * `Pagination` in `components/ui.tsx` stays for surfaces that do know their page count; the two
 * are different models, not duplicates.
 */
export function CursorPagination({
  basePath,
  searchParameters,
  cursorParameter = "cursor",
  previousCursor,
  nextCursor,
  label = "Pagination",
}: Readonly<{
  basePath: string;
  searchParameters: SearchParameters;
  cursorParameter?: string;
  previousCursor?: string | undefined;
  nextCursor?: string | undefined;
  label?: string;
}>) {
  if (!previousCursor && !nextCursor) return null;

  return (
    <nav aria-label={label} className="flex items-center justify-end gap-2">
      {previousCursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={hrefWith(basePath, searchParameters, { [cursorParameter]: previousCursor })} rel="prev">
            Previous
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled aria-disabled="true">
          Previous
        </Button>
      )}
      {nextCursor ? (
        <Button asChild variant="outline" size="sm">
          <Link href={hrefWith(basePath, searchParameters, { [cursorParameter]: nextCursor })} rel="next">
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
