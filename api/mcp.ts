import type { IncomingMessage, ServerResponse } from "node:http";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isAuthorised } from "../src/auth.js";
import { createServer } from "../src/server.js";

// Stateless MCP endpoint. vercel.json maps /mcp/<key> here as ?key=<key>.
export default async function handler(
  req: IncomingMessage & { body?: unknown },
  res: ServerResponse,
) {
  if (!isAuthorised(req)) {
    res.statusCode = 401;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "unauthorised" }));
    return;
  }
  if (req.method !== "POST") {
    // Stateless server: no server-to-client stream, no sessions to delete.
    res.statusCode = 405;
    res.setHeader("Allow", "POST");
    res.end();
    return;
  }
  const server = createServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
    server.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
