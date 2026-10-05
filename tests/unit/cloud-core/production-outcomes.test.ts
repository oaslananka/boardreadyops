import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseProductionOutcomeCsv,
  parseProductionOutcomeJson,
} from "../../../packages/cloud-core/src/production-outcomes.js";

describe("production outcome CSV", () => {
  it("normalizes realistic batch rows, yield values, defects, and provenance", () => {
    const csv = [
      "batch_id,manufacturer,manufactured_on,quantity,first_pass_yield,rework_count,scrap_count,defect_kind,defect_code,defect_count,defect_notes,notes,corrective_action,customer_extra",
      'B-100,"Acme EMS",2026-09-30,1200,97.5%,20,5,aoi,BRIDGE,12,"Across QFN, inspect stencil","Pilot run","AOI threshold tuned",ignored',
      'B-100,"Acme EMS",2026-09-30,1200,97.5%,20,5,spi,PASTE_LOW,7,"Stencil aperture", "Pilot run","AOI threshold tuned",ignored',
      "B-200,Second Source,2026-10-01,500,0.984,4,1,,,,,,,",
    ].join("\n");

    const parsed = parseProductionOutcomeCsv(csv);

    expect(parsed.sourceSha256).toBe(createHash("sha256").update(csv, "utf8").digest("hex"));
    expect(parsed.batches).toHaveLength(2);
    expect(parsed.batches[0]).toEqual({
      externalBatchId: "B-100",
      manufacturer: "Acme EMS",
      manufacturedOn: "2026-09-30",
      quantity: 1200,
      firstPassYieldBps: 9750,
      reworkCount: 20,
      scrapCount: 5,
      notes: "Pilot run",
      correctiveAction: "AOI threshold tuned",
      defects: [
        { category: "aoi", code: "BRIDGE", count: 12, notes: "Across QFN, inspect stencil" },
        { category: "spi", code: "PASTE_LOW", count: 7, notes: "Stencil aperture" },
      ],
    });
    expect(parsed.batches[1]).toMatchObject({
      externalBatchId: "B-200",
      manufacturer: "Second Source",
      firstPassYieldBps: 9840,
      reworkCount: 4,
      scrapCount: 1,
      defects: [],
    });
  });

  it("uses explicit yield notation instead of guessing whether a decimal means percent or ratio", () => {
    const parsed = parseProductionOutcomeCsv(
      [
        "batch_id,manufacturer,manufactured_on,quantity,first_pass_yield",
        "RATIO-50,CM-A,2026-10-02,10,0.5",
        "PERCENT-HALF,CM-A,2026-10-02,10,0.5%",
        "PERCENT-50,CM-A,2026-10-02,10,50%",
      ].join("\n"),
    );

    expect(parsed.batches.map((batch) => [batch.externalBatchId, batch.firstPassYieldBps])).toEqual([
      ["RATIO-50", 5_000],
      ["PERCENT-HALF", 50],
      ["PERCENT-50", 5_000],
    ]);

    expect(() =>
      parseProductionOutcomeCsv(
        ["batch_id,manufacturer,manufactured_on,quantity,first_pass_yield", "AMBIGUOUS,CM-A,2026-10-02,10,50"].join(
          "\n",
        ),
      ),
    ).toThrow("without % must be a ratio between 0 and 1; append % for percentages");
  });

  it("preserves quoted commas, escaped quotes, and embedded newlines", () => {
    const parsed = parseProductionOutcomeCsv(
      [
        "batch_id,manufacturer,manufactured_on,quantity,notes",
        'LOT-1,CM-A,2026-10-02,10,"Line one, ""quoted""',
        'line two"',
      ].join("\n"),
    );

    expect(parsed.batches[0]?.notes).toBe('Line one, "quoted"\nline two');
  });

  it("fails closed when repeated rows change immutable batch metadata", () => {
    const csv = [
      "batch_id,manufacturer,manufactured_on,quantity,defect_kind,defect_code,defect_count",
      "LOT-1,CM-A,2026-10-02,100,aoi,BRIDGE,2",
      "LOT-1,CM-A,2026-10-02,101,spi,PASTE_LOW,1",
    ].join("\n");

    expect(() => parseProductionOutcomeCsv(csv)).toThrow('CSV row 3 changes metadata for batch "LOT-1"');
  });

  it("fails closed on duplicate defect identities within one batch", () => {
    const csv = [
      "batch_id,manufacturer,manufactured_on,quantity,defect_kind,defect_code,defect_count",
      "LOT-1,CM-A,2026-10-02,100,aoi,BRIDGE,2",
      "LOT-1,CM-A,2026-10-02,100,aoi,BRIDGE,3",
    ].join("\n");

    expect(() => parseProductionOutcomeCsv(csv)).toThrow("duplicates defect aoi:BRIDGE");
  });

  it.each([
    ["invalid calendar date", "LOT-1,CM-A,2026-02-30,100", "real calendar date"],
    ["zero quantity", "LOT-1,CM-A,2026-10-02,0", "quantity must be greater than zero"],
    ["yield over 100 percent", "LOT-1,CM-A,2026-10-02,100,101%", "percentage must be between 0% and 100%"],
    ["ambiguous unsuffixed percentage", "LOT-1,CM-A,2026-10-02,100,97.5", "without % must be a ratio between 0 and 1"],
    ["negative rework", "LOT-1,CM-A,2026-10-02,100,, -1", "rework_count must be a non-negative integer"],
  ])("rejects %s", (_label, data, message) => {
    const header = "batch_id,manufacturer,manufactured_on,quantity,first_pass_yield,rework_count";
    expect(() => parseProductionOutcomeCsv([header, data].join("\n"))).toThrow(message);
  });

  it("requires canonical identity headers and rejects duplicates", () => {
    expect(() => parseProductionOutcomeCsv("batch_id,manufacturer,quantity\nB-1,CM,2")).toThrow(
      'missing required header "manufactured_on"',
    );
    expect(() =>
      parseProductionOutcomeCsv("batch_id,manufacturer,manufactured_on,quantity,batch-id\nB-1,CM,2026-10-01,2,B-1"),
    ).toThrow('duplicate header "batch_id"');
  });

  it("bounds rows, columns, and cells while parsing untrusted CSV", () => {
    const tooManyColumns = [
      Array.from({ length: 65 }, (_, index) => `column_${String(index)}`).join(","),
      Array.from({ length: 65 }, () => "value").join(","),
    ].join("\n");
    expect(() => parseProductionOutcomeCsv(tooManyColumns)).toThrow("exceeds 64 columns");

    const oversizedCell = [
      "batch_id,manufacturer,manufactured_on,quantity,notes",
      `LOT-1,CM-A,2026-10-02,10,${"x".repeat(4_001)}`,
    ].join("\n");
    expect(() => parseProductionOutcomeCsv(oversizedCell)).toThrow("cell exceeds 4000 characters");

    const tooManyRows = [
      "batch_id,manufacturer,manufactured_on,quantity",
      ...Array.from({ length: 10_001 }, (_, index) => `LOT-${String(index)},CM-A,2026-10-02,10`),
    ].join("\n");
    expect(() => parseProductionOutcomeCsv(tooManyRows)).toThrow("exceeds 10000 data rows");
  });

  it("rejects malformed quoting and oversized inputs", () => {
    expect(() =>
      parseProductionOutcomeCsv('batch_id,manufacturer,manufactured_on,quantity\n"B-1,CM,2026-10-01,2'),
    ).toThrow("unterminated quoted field");
    const oversized = "x".repeat(2 * 1024 * 1024 + 1);
    expect(() => parseProductionOutcomeCsv(oversized)).toThrow("exceeds the 2 MiB import limit");
  });
});

describe("production outcome JSON", () => {
  it("normalizes one API batch and hashes the exact request body", () => {
    const body = JSON.stringify({
      externalBatchId: "LOT-JSON-1",
      manufacturer: "Acme EMS",
      manufacturedOn: "2026-10-03",
      quantity: 250,
      firstPassYieldBps: 9825,
      reworkCount: 3,
      scrapCount: 1,
      notes: "Pilot batch",
      correctiveAction: "Tune paste volume",
      defects: [
        { category: "spi", code: "PASTE_LOW", count: 2, notes: "QFN area" },
        { category: "functional_test", code: "NO_BOOT", count: 1 },
      ],
    });

    const parsed = parseProductionOutcomeJson(body);

    expect(parsed.sourceSha256).toBe(createHash("sha256").update(body, "utf8").digest("hex"));
    expect(parsed.batch).toEqual({
      externalBatchId: "LOT-JSON-1",
      manufacturer: "Acme EMS",
      manufacturedOn: "2026-10-03",
      quantity: 250,
      firstPassYieldBps: 9825,
      reworkCount: 3,
      scrapCount: 1,
      notes: "Pilot batch",
      correctiveAction: "Tune paste volume",
      defects: [
        { category: "spi", code: "PASTE_LOW", count: 2, notes: "QFN area" },
        { category: "functional_test", code: "NO_BOOT", count: 1 },
      ],
    });
  });

  it("defaults optional counts and defects without inventing yield data", () => {
    const parsed = parseProductionOutcomeJson(
      JSON.stringify({
        externalBatchId: "LOT-JSON-2",
        manufacturer: "Second Source",
        manufacturedOn: "2026-10-04",
        quantity: 10,
      }),
    );

    expect(parsed.batch).toEqual({
      externalBatchId: "LOT-JSON-2",
      manufacturer: "Second Source",
      manufacturedOn: "2026-10-04",
      quantity: 10,
      reworkCount: 0,
      scrapCount: 0,
      defects: [],
    });
  });

  it("normalizes JSON defect categories the same way as CSV", () => {
    const parsed = parseProductionOutcomeJson(
      JSON.stringify({
        externalBatchId: "LOT-CATEGORY",
        manufacturer: "Acme EMS",
        manufacturedOn: "2026-10-04",
        quantity: 5,
        defects: [
          { category: "AOI", code: "BRIDGE", count: 1 },
          { category: "functional-test", code: "NO_BOOT", count: 1 },
        ],
      }),
    );

    expect(parsed.batch.defects.map((defect) => defect.category)).toEqual(["aoi", "functional_test"]);
  });

  it.each([
    ["malformed JSON", "{", "Production outcome JSON is malformed"],
    [
      "unknown batch field",
      JSON.stringify({
        externalBatchId: "B-1",
        manufacturer: "CM",
        manufacturedOn: "2026-10-04",
        quantity: 1,
        privateCustomerField: "secret",
      }),
      'unsupported field "privateCustomerField"',
    ],
    [
      "invalid date",
      JSON.stringify({ externalBatchId: "B-1", manufacturer: "CM", manufacturedOn: "2026-02-30", quantity: 1 }),
      "manufacturedOn must be a real calendar date",
    ],
    [
      "unsafe integer",
      JSON.stringify({
        externalBatchId: "B-1",
        manufacturer: "CM",
        manufacturedOn: "2026-10-04",
        quantity: Number.MAX_SAFE_INTEGER + 1,
      }),
      "quantity must be a safe integer",
    ],
    [
      "wrong numeric type",
      JSON.stringify({
        externalBatchId: "B-1",
        manufacturer: "CM",
        manufacturedOn: "2026-10-04",
        quantity: "1",
      }),
      "quantity must be a number",
    ],
    [
      "yield above 100 percent",
      JSON.stringify({
        externalBatchId: "B-1",
        manufacturer: "CM",
        manufacturedOn: "2026-10-04",
        quantity: 1,
        firstPassYieldBps: 10001,
      }),
      "firstPassYieldBps must be at most 10000",
    ],
    [
      "duplicate defect identity",
      JSON.stringify({
        externalBatchId: "B-1",
        manufacturer: "CM",
        manufacturedOn: "2026-10-04",
        quantity: 1,
        defects: [
          { category: "aoi", code: "BRIDGE", count: 1 },
          { category: "aoi", code: "BRIDGE", count: 2 },
        ],
      }),
      "duplicates defect aoi:BRIDGE",
    ],
  ])("rejects %s", (_label, body, message) => {
    expect(() => parseProductionOutcomeJson(body)).toThrow(message);
  });
});
