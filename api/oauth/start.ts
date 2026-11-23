import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { isAuthorised } from "../../src/auth.js";
import { putState } from "../../src/tokenStore.js";
import { OAUTH_AUTHORIZE_URL, OAUTH_SCOPES, authMode } from "../../src/ultrahuman.js";
import { redirectUri } from "../../src/redirect.js";

// One-time sign-in to Ultrahuman (OAuth app mode only).
// Open https://your-app.vercel.app/oauth/start?key=<MCP_ACCESS_KEY>
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!isAuthorised(req)) {
    res.statusCode = 401;
    res.end("Unauthorised");
    return;
  }
  if (authMode() !== "oauth") {
    res.statusCode = 400;
    res.end("OAuth is not configured (set ULTRAHUMAN_CLIENT_ID and ULTRAHUMAN_CLIENT_SECRET).");
    return;
  }
  const state = randomBytes(24).toString("hex");
  await putState(state);
  const url = new URL(OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", process.env.ULTRAHUMAN_CLIENT_ID as string);
  url.searchParams.set("redirect_uri", redirectUri(req));
  url.searchParams.set("scope", OAUTH_SCOPES);
  url.searchParams.set("state", state);
  res.statusCode = 302;
  res.setHeader("Location", url.toString());
  res.end();
}
