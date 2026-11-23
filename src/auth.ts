import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

// Access control for the hosted server. Fails closed: if MCP_ACCESS_KEY is not
// set, every request is refused.
//
// The key can be sent either as the last part of the URL
// (https://your-app.vercel.app/mcp/<key>, which is what claude.ai custom
// connectors use) or as an "Authorization: Bearer <key>" header.

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function keyFrom(req: IncomingMessage): string | null {
  const url = new URL(req.url ?? "/", "http://localhost");
  const q = url.searchParams.get("key");
  if (q) return q;
  const h = req.headers.authorization;
  if (h?.startsWith("Bearer ")) return h.slice(7).trim();
  return null;
}

export function isAuthorised(req: IncomingMessage): boolean {
  const expected = process.env.MCP_ACCESS_KEY;
  if (!expected || expected.length < 24) return false;
  const given = keyFrom(req);
  return given !== null && safeEqual(given, expected);
}
