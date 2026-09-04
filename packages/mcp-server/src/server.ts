import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { type CliRunner, createCliRunner } from "./cli-runner.ts";
import { runCheckTool, runPlanTool, runVerifyBundleTool, type ToolResult } from "./tools.ts";

const failOnShape = z.enum(["critical", "high", "medium", "low", "never"]).optional();

function toolResponse(result: ToolResult) {
  return {
    isError: !result.ok,
    content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
  };
}

/**
 * Builds the BoardReadyOps MCP server: read-only tools only, each a thin wrapper spawning the
 * real `boardreadyops` CLI (see cli-runner.ts) so results are guaranteed identical to what a
 * human running the same command would see. No tool here can relax a severity threshold,
 * disable a rule, or create a waiver -- release decisions stay entirely in the deterministic
 * CLI pipeline (docs/integrations/boardreadyops-mcp.md's safety model).
 */
export function createBoardReadyOpsMcpServer(runCli: CliRunner = createCliRunner()): McpServer {
  const server = new McpServer({ name: "boardreadyops", version: "0.1.0" });

  server.registerTool(
    "boardreadyops_check",
    {
      description:
        "Runs the full hardware validation pipeline against the KiCad project and returns structured findings.",
      inputSchema: {
        path: z.string().optional().describe("Project directory to check. Defaults to the current directory."),
        config: z.string().optional().describe("Path to a boardreadyops.yml config file."),
        failOn: failOnShape.describe("Minimum severity that counts as a blocking finding."),
      },
    },
    async (input) => toolResponse(await runCheckTool(input, runCli)),
  );

  server.registerTool(
    "boardreadyops_plan",
    {
      description:
        "Returns an ordered remediation plan with fix strategies, safeAutoFixPossible flags, and verification commands.",
      inputSchema: {
        path: z.string().optional().describe("Project directory to plan against. Defaults to the current directory."),
        config: z.string().optional().describe("Path to a boardreadyops.yml config file."),
        failOn: failOnShape.describe("Minimum severity that counts as a blocking finding."),
      },
    },
    async (input) => toolResponse(await runPlanTool(input, runCli)),
  );

  server.registerTool(
    "boardreadyops_verify_bundle",
    {
      description:
        "Verifies cryptographic integrity (SHA-256 checksums, and an Ed25519 signature when a trusted key is given) of an offline evidence bundle.",
      inputSchema: {
        bundleDir: z.string().describe("Directory containing the release evidence bundle (manifest.json, artifacts)."),
        trustedKey: z.string().optional().describe("Path to a trusted Ed25519 public key PEM file."),
      },
    },
    async (input) => toolResponse(await runVerifyBundleTool(input, runCli)),
  );

  return server;
}
