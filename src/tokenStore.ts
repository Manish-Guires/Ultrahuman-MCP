// Stores the Ultrahuman OAuth tokens. Only used in "OAuth app" mode.
//
// Ultrahuman rotates the refresh token every time it is used, so it has to be
// saved somewhere that survives between requests. On Vercel that means a small
// Redis database (Upstash, added from the Vercel Marketplace, free tier is
// plenty). Vercel adds KV_REST_API_URL / KV_REST_API_TOKEN automatically;
// UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN also work.
//
// Without Redis (e.g. running locally), tokens are kept in memory only.

export interface StoredTokens {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
}

const KEY = "ultrahuman:tokens";
let memory: StoredTokens | null = null;

function redis(): { url: string; token: string } | null {
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token =
    process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ""), token } : null;
}

async function redisCommand(cmd: unknown[]): Promise<unknown> {
  const r = redis();
  if (!r) throw new Error("Redis not configured");
  const res = await fetch(r.url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${r.token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(cmd),
  });
  if (!res.ok) throw new Error(`Token store error ${res.status}`);
  return ((await res.json()) as { result: unknown }).result;
}

export function hasPersistentStore(): boolean {
  return redis() !== null;
}

export async function getTokens(): Promise<StoredTokens | null> {
  if (redis()) {
    const raw = await redisCommand(["GET", KEY]);
    if (typeof raw === "string") return JSON.parse(raw) as StoredTokens;
    return null;
  }
  return memory;
}

export async function saveTokens(tokens: StoredTokens): Promise<void> {
  if (redis()) {
    await redisCommand(["SET", KEY, JSON.stringify(tokens)]);
    return;
  }
  memory = tokens;
}

/** One-time values used to protect the sign-in flow (CSRF state). */
export async function putState(state: string): Promise<void> {
  if (redis()) {
    await redisCommand(["SET", `ultrahuman:state:${state}`, "1", "EX", 600]);
    return;
  }
  states.add(state);
}

export async function takeState(state: string): Promise<boolean> {
  if (redis()) {
    const v = await redisCommand(["GETDEL", `ultrahuman:state:${state}`]);
    return v === "1";
  }
  return states.delete(state);
}

const states = new Set<string>();
