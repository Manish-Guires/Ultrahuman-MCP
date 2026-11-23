import type { IncomingMessage } from "node:http";

export function redirectUri(req: IncomingMessage): string {
  if (process.env.ULTRAHUMAN_REDIRECT_URI) return process.env.ULTRAHUMAN_REDIRECT_URI;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host;
  return `https://${host}/oauth/callback`;
}
