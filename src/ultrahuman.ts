// Ultrahuman API client. Read-only: this file only ever issues GET requests
// for metrics, plus the OAuth token exchange/refresh calls.
//
// Two ways to authenticate, picked automatically from environment variables:
//
// 1. "Personal key" (the older route; Ultrahuman support emails you a key):
//      ULTRAHUMAN_AUTH_TOKEN, ULTRAHUMAN_USER_EMAIL
// 2. "OAuth app" (the newer route; you create an app in Ultrahuman's developer
//    dashboard and sign in once):
//      ULTRAHUMAN_CLIENT_ID, ULTRAHUMAN_CLIENT_SECRET, plus a token store
//      (see tokenStore.ts) that keeps the rotating refresh token.

import { getTokens, saveTokens, type StoredTokens } from "./tokenStore.js";

const LEGACY_BASE = "https://partner.ultrahuman.com/api/v1";
const OAUTH_BASE = "https://partner.ultrahuman.com/api/partners/v1";
export const OAUTH_AUTHORIZE_URL = "https://auth.ultrahuman.com/authorise";
export const OAUTH_TOKEN_URL =
  "https://partner.ultrahuman.com/api/partners/oauth/token";
export const OAUTH_SCOPES = "ring_data cgm_data profile";

export type AuthMode = "legacy" | "oauth" | "none";

export function authMode(): AuthMode {
  if (process.env.ULTRAHUMAN_AUTH_TOKEN && process.env.ULTRAHUMAN_USER_EMAIL)
    return "legacy";
  if (process.env.ULTRAHUMAN_CLIENT_ID && process.env.ULTRAHUMAN_CLIENT_SECRET)
    return "oauth";
  return "none";
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function assertDate(date: string): void {
  if (!DATE_RE.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
    throw new Error(`Invalid date "${date}". Use YYYY-MM-DD.`);
  }
}

async function getJson(url: URL, authorization: string): Promise<unknown> {
  const res = await fetch(url, {
    method: "GET",
    headers: { Authorization: authorization, Accept: "application/json" },
  });
  const text = await res.text();
  if (!res.ok) {
    // Never echo headers or tokens; the body is Ultrahuman's error message.
    throw new Error(
      `Ultrahuman API returned ${res.status} ${res.statusText}: ${text.slice(0, 300)}`,
    );
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error("Ultrahuman API returned a non-JSON response.");
  }
  const err = (body as { error?: unknown })?.error;
  if (err) throw new Error(`Ultrahuman API error: ${JSON.stringify(err)}`);
  return body;
}

// ---- OAuth token handling -------------------------------------------------

export async function exchangeToken(
  params: Record<string, string>,
): Promise<StoredTokens> {
  const body = new URLSearchParams({
    client_id: process.env.ULTRAHUMAN_CLIENT_ID ?? "",
    client_secret: process.env.ULTRAHUMAN_CLIENT_SECRET ?? "",
    ...params,
  });
  const res = await fetch(OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(
      `Ultrahuman token request failed (${res.status}): ${text.slice(0, 300)}`,
    );
  }
  const json = JSON.parse(text) as {
    access_token: string;
    refresh_token?: string;
    expires_in?: number;
  };
  return {
    access_token: json.access_token,
    refresh_token: json.refresh_token ?? "",
    // Refresh one minute early to be safe.
    expires_at: Date.now() + ((json.expires_in ?? 86400) - 60) * 1000,
  };
}

let refreshing: Promise<string> | null = null;

async function oauthAccessToken(): Promise<string> {
  const tokens = await getTokens();
  if (!tokens) {
    throw new Error(
      "Ultrahuman is not signed in yet. Open /oauth/start on this server once to connect your ring account.",
    );
  }
  if (tokens.expires_at > Date.now()) return tokens.access_token;
  // Refresh tokens rotate, so make sure only one refresh runs at a time.
  if (!refreshing) {
    refreshing = (async () => {
      const fresh = await exchangeToken({
        grant_type: "refresh_token",
        refresh_token: tokens.refresh_token,
      });
      if (!fresh.refresh_token) fresh.refresh_token = tokens.refresh_token;
      await saveTokens(fresh);
      return fresh.access_token;
    })().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

// ---- Metrics ---------------------------------------------------------------

/** Raw metrics for one calendar day, exactly as Ultrahuman returns them. */
export async function fetchDay(date: string): Promise<unknown> {
  assertDate(date);
  const mode = authMode();
  if (mode === "legacy") {
    const url = new URL(`${LEGACY_BASE}/metrics`);
    url.searchParams.set("email", process.env.ULTRAHUMAN_USER_EMAIL as string);
    url.searchParams.set("date", date);
    return getJson(url, process.env.ULTRAHUMAN_AUTH_TOKEN as string);
  }
  if (mode === "oauth") {
    const url = new URL(`${OAUTH_BASE}/user_data/metrics`);
    url.searchParams.set("date", date);
    return getJson(url, `Bearer ${await oauthAccessToken()}`);
  }
  throw new Error(
    "No Ultrahuman credentials configured. Set ULTRAHUMAN_AUTH_TOKEN + ULTRAHUMAN_USER_EMAIL, or ULTRAHUMAN_CLIENT_ID + ULTRAHUMAN_CLIENT_SECRET.",
  );
}

export function datesBetween(start: string, end: string): string[] {
  assertDate(start);
  assertDate(end);
  const out: string[] = [];
  const d = new Date(`${start}T00:00:00Z`);
  const last = new Date(`${end}T00:00:00Z`);
  if (d > last) throw new Error("start_date must be on or before end_date.");
  while (d <= last) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

/** Fetch several days with limited parallelism so we stay polite to the API. */
export async function fetchRange(
  dates: string[],
  concurrency = 4,
): Promise<Record<string, unknown>> {
  const results: Record<string, unknown> = {};
  let i = 0;
  async function worker() {
    while (i < dates.length) {
      const date = dates[i++];
      try {
        results[date] = await fetchDay(date);
      } catch (e) {
        results[date] = { error: (e as Error).message };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, dates.length) }, worker));
  return Object.fromEntries(dates.map((d) => [d, results[d]]));
}
