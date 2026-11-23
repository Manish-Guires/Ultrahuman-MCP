import assert from "node:assert/strict";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import handler from "../api/mcp.js";
import { compact, filterTypes, metricTypes } from "../src/compact.js";

const KEY = "test-key-0123456789abcdef0123456789";
const calls: { url: string; auth: string | null }[] = [];
const realFetch = globalThis.fetch;

// Fake Ultrahuman API: one day with a long heart-rate series and a sleep entry.
const sample = (date: string) => ({
  status: "ok",
  data: {
    metrics: {
      [date]: [
        { type: "hr", object: { values: Array.from({ length: 100 }, (_, i) => ({ value: 50 + (i % 10), timestamp: i })) } },
        { type: "sleep", object: { total_sleep: 420, score: 81 } },
      ],
    },
  },
});

let base = "";
const server = createHttpServer(async (req: IncomingMessage & { body?: unknown }, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  req.body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined;
  await handler(req, res);
});

before(async () => {
  process.env.MCP_ACCESS_KEY = KEY;
  process.env.ULTRAHUMAN_AUTH_TOKEN = "uh-secret";
  process.env.ULTRAHUMAN_USER_EMAIL = "ring@example.com";
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (url.startsWith("https://partner.ultrahuman.com/")) {
      const h = new Headers(init?.headers);
      calls.push({ url, auth: h.get("authorization") });
      const date = new URL(url).searchParams.get("date") as string;
      return new Response(JSON.stringify(sample(date)), { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  globalThis.fetch = realFetch;
  server.close();
});

async function connect(key: string) {
  const client = new Client({ name: "test", version: "0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/?key=${key}`)));
  return client;
}

test("rejects requests without the right access key", async () => {
  await assert.rejects(connect("wrong-key-wrong-key-wrong-key-xx"));
  const res = await realFetch(`${base}/`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(res.status, 401);
});

test("fails closed when MCP_ACCESS_KEY is unset", async () => {
  const saved = process.env.MCP_ACCESS_KEY;
  delete process.env.MCP_ACCESS_KEY;
  const res = await realFetch(`${base}/?key=${KEY}`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
  assert.equal(res.status, 401);
  process.env.MCP_ACCESS_KEY = saved;
});

test("lists three read-only tools", async () => {
  const client = await connect(KEY);
  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((t) => t.name).sort(), [
    "ultrahuman_daily_metrics",
    "ultrahuman_list_metric_types",
    "ultrahuman_metrics_range",
  ]);
  for (const t of tools) assert.equal(t.annotations?.readOnlyHint, true);
  await client.close();
});

test("daily metrics calls the legacy endpoint and summarises long series", async () => {
  calls.length = 0;
  const client = await connect(KEY);
  const r = (await client.callTool({ name: "ultrahuman_daily_metrics", arguments: { date: "2026-11-20" } })) as { content: { text: string }[] };
  const body = JSON.parse(r.content[0].text);
  const hr = body.data.metrics["2026-11-20"][0].object.values;
  assert.equal(hr.summarised_series, true);
  assert.equal(hr.points, 100);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].auth, "uh-secret");
  const u = new URL(calls[0].url);
  assert.equal(u.pathname, "/api/v1/metrics");
  assert.equal(u.searchParams.get("email"), "ring@example.com");
  await client.close();
});

test("range fetches every day and applies the metric filter", async () => {
  calls.length = 0;
  const client = await connect(KEY);
  const r = (await client.callTool({
    name: "ultrahuman_metrics_range",
    arguments: { start_date: "2026-11-01", end_date: "2026-11-07", metric_types: ["sleep"] },
  })) as { content: { text: string }[] };
  const body = JSON.parse(r.content[0].text);
  assert.deepEqual(Object.keys(body).length, 7);
  assert.equal(calls.length, 7);
  const day = body["2026-11-03"].data.metrics["2026-11-03"];
  assert.deepEqual(day.map((e: { type: string }) => e.type), ["sleep"]);
  await client.close();
});

test("range over 31 days and bad dates are rejected", async () => {
  const client = await connect(KEY);
  const r = (await client.callTool({ name: "ultrahuman_metrics_range", arguments: { start_date: "2026-01-01", end_date: "2026-03-01" } })) as { isError?: boolean };
  assert.equal(r.isError, true);
  const r2 = (await client.callTool({ name: "ultrahuman_daily_metrics", arguments: { date: "20-11-2026" } })) as { isError?: boolean };
  assert.equal(r2.isError, true);
  await client.close();
});

test("compact helpers", () => {
  assert.deepEqual([...metricTypes(sample("d"))].sort(), ["hr", "sleep"]);
  const f = filterTypes(sample("d"), ["HR"]) as ReturnType<typeof sample>;
  assert.equal(f.data.metrics.d.length, 1);
  assert.deepEqual(compact([1, 2, 3]), [1, 2, 3]);
});
