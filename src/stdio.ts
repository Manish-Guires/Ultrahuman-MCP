#!/usr/bin/env node
// Local mode for Claude Desktop / Claude Code (no web server, no access key).
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer } from "./server.js";

const server = createServer();
await server.connect(new StdioServerTransport());
console.error("Ultrahuman MCP server running on stdio");
