/**
 * @vitest-environment happy-dom
 */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import ManufacturerIntakePage, { generateMetadata } from "../../../apps/web/app/intake/[slug]/page.js";
import { ManufacturerIntakeWidget } from "../../../apps/web/components/intake/manufacturer-intake-widget.js";

const runtime = globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean };

describe("Manufacturer Pre-Flight Intake Portal", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    runtime.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    delete runtime.IS_REACT_ACT_ENVIRONMENT;
  });

  it("generates correct metadata for known and custom fabricators", async () => {
    const metaEuro = await generateMetadata({ params: Promise.resolve({ slug: "eurocircuits" }) });
    expect(metaEuro.title).toContain("Eurocircuits Quick-Turn");
    expect(metaEuro.description).toContain("Eurocircuits Quick-Turn");

    const metaCustom = await generateMetadata({ params: Promise.resolve({ slug: "my-fab" }) });
    expect(metaCustom.title).toContain("MY-FAB Fabrication");
  });

  it("renders the intake widget with partner information", async () => {
    await act(async () => {
      root.render(
        createElement(ManufacturerIntakeWidget, {
          partnerSlug: "eurocircuits",
          partnerName: "Eurocircuits Quick-Turn",
        }),
      );
    });

    const text = container.textContent || "";
    expect(text).toContain("Eurocircuits Quick-Turn");
    expect(text).toContain("EUROCIRCUITS");
    expect(container.querySelector('[data-testid="intake-dropzone"]')).not.toBeNull();
  });

  it("renders the full page with breadcrumbs", async () => {
    const page = await ManufacturerIntakePage({ params: Promise.resolve({ slug: "jlcpcb" }) });
    await act(async () => {
      root.render(page);
    });

    const text = container.textContent || "";
    expect(text).toContain("JLCPCB SMT Production");
    expect(text).toContain("Manufacturer Intake");
  });
});
