import agentPlanSchema from "../../../schemas/agent-plan.schema.json" with { type: "json" };
import configSchema from "../../../schemas/config.schema.json" with { type: "json" };
import doctorSchema from "../../../schemas/doctor.schema.json" with { type: "json" };
import findingsSchema from "../../../schemas/findings.schema.json" with { type: "json" };
import generateRecipeSchema from "../../../schemas/generate-recipe.schema.json" with { type: "json" };
import hbomSchema from "../../../schemas/hbom.schema.json" with { type: "json" };
import pinmapSchema from "../../../schemas/pinmap.schema.json" with { type: "json" };
import reviewPublishResultSchema from "../../../schemas/review-publish-result.schema.json" with { type: "json" };

const SCHEMAS: Record<string, unknown> = {
  config: configSchema,
  "agent-plan": agentPlanSchema,
  plan: agentPlanSchema,
  doctor: doctorSchema,
  findings: findingsSchema,
  hbom: hbomSchema,
  pinmap: pinmapSchema,
  "review-publish": reviewPublishResultSchema,
  "review-publish-result": reviewPublishResultSchema,
  generate: generateRecipeSchema,
};

export function schemaCommand(
  name: string | undefined,
  streams: { stdout: NodeJS.WritableStream; stderr: NodeJS.WritableStream },
): number {
  const selectedName = name ?? "config";
  if (!Object.hasOwn(SCHEMAS, selectedName)) {
    streams.stderr.write(
      `Unknown schema: ${selectedName || "(empty)"}. Available schemas: ${Object.keys(SCHEMAS).join(", ")}.\n`,
    );
    return 2;
  }
  streams.stdout.write(`${JSON.stringify(SCHEMAS[selectedName], null, 2)}\n`);
  return 0;
}
