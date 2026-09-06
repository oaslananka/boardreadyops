import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CursorPagination, type DataColumn, DataTable } from "../../../apps/web/components/ui/data-table.js";

type Row = { id: string; name: string; count: number };

const rows: Row[] = [
  { id: "a", name: "alpha", count: 2 },
  { id: "b", name: "beta", count: 7 },
];

const columns: readonly DataColumn<Row>[] = [
  { id: "name", header: "Name", rowHeader: true, sortable: true, cell: (row) => row.name, className: "name-cell" },
  { id: "count", header: "Count", align: "end", cell: (row) => row.count },
];

function render(props: Partial<Parameters<typeof DataTable<Row>>[0]> = {}): string {
  return renderToStaticMarkup(
    createElement(DataTable<Row>, {
      columns,
      rows,
      rowKey: (row) => row.id,
      caption: "Test rows",
      basePath: "/runs",
      searchParameters: { status: "failed" },
      empty: createElement("p", null, "Nothing here"),
      ...props,
    }),
  );
}

describe("DataTable", () => {
  it("renders the empty slot instead of an empty table shell", () => {
    const markup = render({ rows: [] });
    expect(markup).toContain("Nothing here");
    expect(markup).not.toContain("<table");
  });

  it("announces the caption to assistive tech without showing it", () => {
    expect(render()).toContain("Test rows");
    expect(render()).toContain("sr-only");
  });

  it("renders the row-header column as a th so each row announces its own label", () => {
    const markup = render();
    expect(markup).toContain('<th scope="row"');
    expect(markup.match(/<th scope="row"/gu)).toHaveLength(rows.length);
  });

  it("keeps caller class hooks on the cell", () => {
    expect(render()).toContain("name-cell");
  });

  it("links a sortable header to the ascending order first and preserves other parameters", () => {
    const markup = render();
    expect(markup).toContain("/runs?status=failed&amp;sort=name&amp;dir=asc");
    expect(markup).toContain('aria-sort="none"');
  });

  it("flips an already-ascending column to descending and reports the current order", () => {
    const markup = render({ sort: { column: "name", direction: "asc" } });
    expect(markup).toContain("dir=desc");
    expect(markup).toContain('aria-sort="ascending"');
  });

  it("leaves non-sortable headers as plain text with no sort link", () => {
    const markup = render();
    expect(markup).not.toContain("sort=count");
  });
});

describe("CursorPagination", () => {
  it("renders nothing when there is only one page of results", () => {
    expect(renderToStaticMarkup(createElement(CursorPagination, { basePath: "/runs", searchParameters: {} }))).toBe("");
  });

  it("disables the direction that has no cursor and links the one that does", () => {
    const markup = renderToStaticMarkup(
      createElement(CursorPagination, { basePath: "/runs", searchParameters: { q: "x" }, nextCursor: "c2" }),
    );
    expect(markup).toContain('aria-disabled="true"');
    expect(markup).toContain("/runs?q=x&amp;cursor=c2");
    expect(markup).toContain('rel="next"');
  });
});
