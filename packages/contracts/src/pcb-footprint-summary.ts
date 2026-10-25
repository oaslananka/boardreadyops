import { z } from "zod";

const sha256 = z.string().regex(/^[0-9a-f]{64}$/u);
const gitObjectId = z.string().regex(/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u);
const footprintCount = z.number().int().min(0).max(10_000);

const changedFieldsSchema = z
  .object({
    reference: footprintCount,
    libraryId: footprintCount,
    layer: footprintCount,
    positionMm: footprintCount,
    rotationDeg: footprintCount,
  })
  .strict();

/**
 * V1 disclosure-minimal, local Git source-backed evidence summary.
 * No PCB source text, object UUIDs, coordinates, references, library IDs,
 * physical geometry, manufacturing suitability, or risk verdict.
 *
 * This contract alone does NOT authorize upload. The optional Review publish
 * route separately checks caller/repository authority, commit binding and
 * explicit consent, and retains the summary with its owning run. The server
 * cannot independently establish the truth of client-reported source facts.
 */
export const pcbFootprintSummarySchema = z
  .object({
    schemaVersion: z.literal(1),
    scope: z.literal("pcb-footprints-only"),
    provenance: z.literal("local-git-commits"),
    disclosure: z.literal("counts-and-digests-only"),
    baseCommitSha: gitObjectId,
    headCommitSha: gitObjectId,
    baseBlobSha: gitObjectId,
    headBlobSha: gitObjectId,
    baseSourceSha256: sha256,
    headSourceSha256: sha256,
    changes: z
      .object({
        added: footprintCount,
        removed: footprintCount,
        modified: footprintCount,
        byField: changedFieldsSchema,
      })
      .strict(),
    riskAssessment: z.literal("not-evaluated"),
  })
  .strict()
  .superRefine((value, ctx) => {
    const { changes } = value;
    if (changes.added + changes.removed + changes.modified > 20_000) {
      ctx.addIssue({ code: "custom", path: ["changes"], message: "too many reported changes" });
    }
    let fields = 0;
    for (const [field, count] of Object.entries(changes.byField)) {
      if (count > changes.modified) {
        ctx.addIssue({
          code: "custom",
          path: ["changes", "byField", field],
          message: "field count exceeds modified objects",
        });
      }
      fields += count;
    }
    if (fields < changes.modified) {
      ctx.addIssue({
        code: "custom",
        path: ["changes", "byField"],
        message: "each modified object must have a changed field",
      });
    }
  });

export type PcbFootprintSummary = z.infer<typeof pcbFootprintSummarySchema>;
