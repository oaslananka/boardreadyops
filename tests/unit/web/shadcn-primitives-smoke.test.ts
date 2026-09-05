/**
 * @vitest-environment happy-dom
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AlertDescription, AlertRoot, AlertTitle } from "../../../apps/web/components/ui/alert.js";
import { Badge } from "../../../apps/web/components/ui/badge.js";
import { Button } from "../../../apps/web/components/ui/button.js";
import { Card, CardContent, CardHeader, CardTitle } from "../../../apps/web/components/ui/card.js";
import { Separator } from "../../../apps/web/components/ui/separator.js";

describe("shadcn primitive smoke test", () => {
  it("renders Button, Badge, Card, Separator, and Alert without throwing", () => {
    const markup = renderToStaticMarkup(
      createElement(
        "div",
        null,
        createElement(Button, { variant: "outline" }, "Click"),
        createElement(Badge, { variant: "danger" }, "3 open"),
        createElement(Separator),
        createElement(
          Card,
          null,
          createElement(CardHeader, null, createElement(CardTitle, null, "Title")),
          createElement(CardContent, null, "Body"),
        ),
        createElement(
          AlertRoot,
          { variant: "warning" },
          createElement(AlertTitle, null, "Heads up"),
          createElement(AlertDescription, null, "Detail"),
        ),
      ),
    );
    expect(markup).toContain("Click");
    expect(markup).toContain("3 open");
    expect(markup).toContain("Title");
    expect(markup).toContain("Heads up");
  });
});
