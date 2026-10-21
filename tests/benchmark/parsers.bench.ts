import { bench, describe } from "vitest";
import { parseDelimited } from "../../src/bom/loader.js";
import { normalizeBomRows } from "../../src/bom/normalizer.js";
import { findSexprLists, parseSexprDocument, sexprChildValue } from "../../src/kicad/sexpr.js";

const FOOTPRINT_COUNT = 300;
const BOM_ROW_COUNT = 500;

function syntheticPcb(footprints: number): string {
  const blocks = Array.from(
    { length: footprints },
    (_, index) => `  (footprint "Resistor_SMD:R_0603"
    (layer "F.Cu")
    (at ${index % 50} ${Math.floor(index / 50)} 90)
    (property "Reference" "R${index}")
    (property "Value" "${index % 2 === 0 ? "10k" : "4k7"}")
    (pad "1" smd roundrect (at -0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask") (net 1 "GND"))
    (pad "2" smd roundrect (at 0.8 0) (size 0.9 0.95) (layers "F.Cu" "F.Paste" "F.Mask") (net ${index + 2} "N${index}"))
  )`,
  );
  return `(kicad_pcb
  (version 20250114)
  (title_block (title "synthetic") (rev "v1.0"))
  (gr_rect (start 0 0) (end 100 100) (layer "Edge.Cuts"))
${blocks.join("\n")}
)
`;
}

function syntheticBom(rows: number): string {
  const header = "Reference,Value,Footprint,Manufacturer,MPN,Supplier 1,Lifecycle,DNP";
  const lines = Array.from(
    { length: rows },
    (_, index) =>
      `R${index},${index % 3 === 0 ? "10k" : "100k"},Resistor_SMD:R_0603,Yageo,RC0603FR-07${index}KL,DigiKey,Active,${index % 17 === 0}`,
  );
  return [header, ...lines].join("\n");
}

const pcbText = syntheticPcb(FOOTPRINT_COUNT);
const bomText = syntheticBom(BOM_ROW_COUNT);
const parsedPcb = parseSexprDocument(pcbText);
const bomRecords = parseDelimited(bomText);

describe("kicad s-expression parsing", () => {
  bench(`parse PCB document (${FOOTPRINT_COUNT} footprints)`, () => {
    parseSexprDocument(pcbText);
  });

  bench(`query footprint layers (${FOOTPRINT_COUNT} footprints)`, () => {
    for (const footprint of findSexprLists(parsedPcb, "footprint")) {
      sexprChildValue(footprint, "layer");
    }
  });
});

describe("BOM parsing", () => {
  bench(`parse delimited CSV (${BOM_ROW_COUNT} rows)`, () => {
    parseDelimited(bomText);
  });

  bench(`normalize BOM rows (${BOM_ROW_COUNT} rows)`, () => {
    normalizeBomRows(bomRecords, "bom.csv");
  });
});
