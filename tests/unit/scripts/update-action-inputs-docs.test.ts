import { describe, expect, it } from "vitest";

import { renderActionDocs } from "../../../scripts/update-action-inputs-docs.mjs";

const document = `# GitHub Action

- uses: oaslananka/boardreadyops@884f5fa31f8fd701693c533747c69eb7d13f5464 # v1.30.1

The public \`v1.30.1\` tag is the current published release.

## Inputs

| Name | Default | Description |
| --- | --- | --- |
| \`old\` | \`old\` | old |

## Outputs

| Name | Description |
| --- | --- |
| \`old\` | old |

## Pull request comments

Keep this prose unchanged.
`;

describe("update-action-inputs-docs", () => {
  it("updates generated tables without rewriting the reviewed release pin or surrounding prose", () => {
    const result = renderActionDocs(document, {
      inputs: {
        config: { default: "boardreadyops.yml", description: "Path to config." },
      },
      outputs: {
        findings: { description: "Total finding count." },
      },
    });

    expect(result).toContain("oaslananka/boardreadyops@884f5fa31f8fd701693c533747c69eb7d13f5464 # v1.30.1");
    expect(result).toContain("The public `v1.30.1` tag is the current published release.");
    expect(result).toContain("| `config` | `boardreadyops.yml` | Path to config. |");
    expect(result).toContain("| `findings` | Total finding count. |");
    expect(result).not.toContain("| `old` | `old` | old |");
    expect(result).toContain("Keep this prose unchanged.");
  });

  it("fails closed when generated table boundaries are missing", () => {
    expect(() => renderActionDocs("# GitHub Action\n", { inputs: {}, outputs: {} })).toThrow(
      /generated Action documentation marker not found/,
    );
  });
});
