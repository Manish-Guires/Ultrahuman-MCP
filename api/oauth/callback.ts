import type { IncomingMessage, ServerResponse } from "node:http";
import { hasPersistentStore, saveTokens, takeState } from "../../src/tokenStore.js";
import { exchangeToken } from "../../src/ultrahuman.js";
import { redirectUri } from "../../src/redirect.js";

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? "/", "http://localhost");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  if (!code || !state || !(await takeState(state))) {
    res.statusCode = 400;
    res.end("Sign-in link expired or invalid. Start again from /oauth/start.");
    return;
  }
  try {
    const tokens = await exchangeToken({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(req),
    });
    await saveTokens(tokens);
    res.end(
      hasPersistentStore()
        ? "Ultrahuman connected. You can close this tab."
        : "Connected, but no Redis store is configured, so this will be forgotten. Add Upstash Redis in Vercel and sign in again.",
    );
  } catch (e) {
    res.statusCode = 502;
    res.end(`Could not finish sign-in: ${(e as Error).message}`);
  }
}
