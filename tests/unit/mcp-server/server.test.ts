import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CliRunner, CliRunResult } from "../../../packages/mcp-server/src/cli-runner.js";
import { createBoardReadyOpsMcpServer } from "../../../packages/mcp-server/src/server.js";

function fakeRunner(byCommand: Record<string, CliRunResult>): CliRunner {
  return vi.fn(async (args: string[]) => {
    const key = args[0] === "release" ? "release verify" : args[0];
    const match = key ? byCommand[key] : undefined;
    if (!match) throw new Error(`no fake response configured for: ${args.join(" ")}`);
    return match;
  });
}

async function connectedClient(runner: CliRunner): Promise<Client> {
  const server = createBoardReadyOpsMcpServer(runner);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
}

describe("createBoardReadyOpsMcpServer", () => {
  let runner: CliRunner;

  beforeEach(() => {
    runner = fakeRunner({
      check: { exitCode: 0, stdout: `${JSON.stringify({ summary: { total: 0, failed: false } })}\n`, stderr: "" },
      plan: { exitCode: 0, stdout: `${JSON.stringify({ nextActions: [] })}\n`, stderr: "" },
      "release verify": { exitCode: 0, stdout: `${JSON.stringify({ ok: true, checked: 2 })}\n`, stderr: "" },
      review: {
        exitCode: 0,
        stdout: `${JSON.stringify({ schemaVersion: 1, scope: "pcb-footprints-only", changes: { added: 1, removed: 0, modified: 0 } })}\n`,
        stderr: "",
      },
    });
  });

  it("advertises exactly four read-only tools, with no mutating capability", async () => {
    const client = await connectedClient(runner);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "boardreadyops_check",
      "boardreadyops_footprint_summary",
      "boardreadyops_plan",
      "boardreadyops_verify_bundle",
    ]);
  });

  it("no registered tool accepts a parameter that could relax a severity gate, disable a rule, or approve a waiver", async () => {
    const client = await connectedClient(runner);
    const { tools } = await client.listTools();

    const dangerousParameterNames = /disableRule|skipRule|ignoreRule|approveWaiver|overrideSeverity|bypass/i;
    for (const tool of tools) {
      const properties = (tool.inputSchema as { properties?: Record<string, unknown> }).properties ?? {};
      for (const propertyName of Object.keys(properties)) {
        expect(propertyName).not.toMatch(dangerousParameterNames);
      }
    }
  });

  it("boardreadyops_check spawns the real CLI and returns its parsed result", async () => {
    const client = await connectedClient(runner);

    const result = await client.callTool({ name: "boardreadyops_check", arguments: { path: "/board" } });

    expect(result.isError).toBeFalsy();
    expect(runner).toHaveBeenCalledWith(["check", "--format", "json", "/board"]);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({ ok: true, result: { summary: { total: 0, failed: false } } });
  });

  it("boardreadyops_footprint_summary returns only the CLI's summary evidence", async () => {
    const client = await connectedClient(runner);
    const result = await client.callTool({
      name: "boardreadyops_footprint_summary",
      arguments: { path: "/board", base: "HEAD~1", head: "HEAD", pcb: "test.kicad_pcb" },
    });
    expect(result.isError).toBeFalsy();
    expect(runner).toHaveBeenCalledWith([
      "review",
      "footprint-diff",
      "--base",
      "HEAD~1",
      "--head",
      "HEAD",
      "--pcb",
      "test.kicad_pcb",
      "--format",
      "summary-json",
      "/board",
    ]);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(JSON.parse(text)).toEqual({
      ok: true,
      result: { schemaVersion: 1, scope: "pcb-footprints-only", changes: { added: 1, removed: 0, modified: 0 } },
    });
  });

  it("requires source, base and head identities before invoking any subprocess", async () => {
    const client = await connectedClient(runner);
    const result = await client.callTool({
      name: "boardreadyops_footprint_summary",
      arguments: { base: "HEAD" },
    });
    expect(result.isError).toBe(true);
    expect(runner).not.toHaveBeenCalled();
  });

  it("boardreadyops_verify_bundle requires bundleDir per its schema", async () => {
    const client = await connectedClient(runner);

    const result = await client.callTool({ name: "boardreadyops_verify_bundle", arguments: {} });

    expect(result.isError).toBe(true);
    const text = (result.content as Array<{ type: string; text: string }>)[0]?.text ?? "";
    expect(text).toContain("bundleDir");
  });

  it("marks the tool result as an error when the underlying CLI call fails", async () => {
    const failingRunner = fakeRunner({
      check: { exitCode: 3, stdout: "", stderr: "kicad-cli not found\n" },
      plan: { exitCode: 0, stdout: "{}\n", stderr: "" },
      "release verify": { exitCode: 0, stdout: "{}\n", stderr: "" },
    });
    const client = await connectedClient(failingRunner);

    const result = await client.callTool({ name: "boardreadyops_check", arguments: {} });

    expect(result.isError).toBe(true);
  });
});
