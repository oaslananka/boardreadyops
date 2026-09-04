import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createBoardReadyOpsMcpServer } from "./server.ts";

const server = createBoardReadyOpsMcpServer();
const transport = new StdioServerTransport();
await server.connect(transport);
// stderr only -- stdout is the JSON-RPC channel and must never carry anything else.
process.stderr.write("BoardReadyOps MCP server running on stdio\n");
