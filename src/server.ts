import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { compact, filterTypes, metricTypes } from "./compact.js";
import { authMode, datesBetween, fetchDay, fetchRange } from "./ultrahuman.js";

export const VERSION = "1.0.0";
const MAX_RANGE_DAYS = 31;

function text(value: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
  };
}

function fail(e: unknown) {
  return {
    content: [{ type: "text" as const, text: `Error: ${(e as Error).message}` }],
    isError: true,
  };
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

const metricFilter = z
  .array(z.string())
  .optional()
  .describe(
    'Optional: only return these metric types, e.g. ["sleep","hrv","recovery_index","steps"]. Call ultrahuman_list_metric_types to see what exists.',
  );

/** Every tool here is read-only: nothing can change data in the Ultrahuman account. */
export function createServer(): McpServer {
  const server = new McpServer({ name: "ultrahuman", version: VERSION });
  const readOnly = { readOnlyHint: true, destructiveHint: false, openWorldHint: true };

  server.registerTool(
    "ultrahuman_daily_metrics",
    {
      title: "Ultrahuman metrics for one day",
      description:
        "Get Ultrahuman ring metrics for a single day: sleep, HRV, resting heart rate, recovery, movement, steps, skin temperature, VO2 max and (if a glucose patch is used) glucose. Set detailed=true to get minute-level series; otherwise long series are summarised as min/avg/max.",
      inputSchema: {
        date: z.string().optional().describe("YYYY-MM-DD. Defaults to today (UTC)."),
        metric_types: metricFilter,
        detailed: z.boolean().optional().describe("Return full minute-level series."),
      },
      annotations: readOnly,
    },
    async ({ date, metric_types, detailed }) => {
      try {
        const raw = filterTypes(await fetchDay(date ?? today()), metric_types);
        return text(detailed ? raw : compact(raw));
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ultrahuman_metrics_range",
    {
      title: "Ultrahuman metrics over a date range",
      description: `Get Ultrahuman ring metrics for every day from start_date to end_date (max ${MAX_RANGE_DAYS} days). Use this for trends such as "how has my sleep been this month" or "HRV over the last two weeks". Long series are summarised as min/avg/max per day. Pass metric_types to keep the answer small.`,
      inputSchema: {
        start_date: z.string().describe("YYYY-MM-DD"),
        end_date: z.string().optional().describe("YYYY-MM-DD. Defaults to today (UTC)."),
        metric_types: metricFilter,
      },
      annotations: readOnly,
    },
    async ({ start_date, end_date, metric_types }) => {
      try {
        const dates = datesBetween(start_date, end_date ?? today());
        if (dates.length > MAX_RANGE_DAYS) {
          throw new Error(
            `Range is ${dates.length} days; the maximum is ${MAX_RANGE_DAYS}. Split it into smaller ranges.`,
          );
        }
        const days = await fetchRange(dates);
        const out = Object.fromEntries(
          Object.entries(days).map(([d, v]) => [d, compact(filterTypes(v, metric_types))]),
        );
        return text(out);
      } catch (e) {
        return fail(e);
      }
    },
  );

  server.registerTool(
    "ultrahuman_list_metric_types",
    {
      title: "List available Ultrahuman metric types",
      description:
        "List the metric type names present in the Ultrahuman data for a day (e.g. sleep, hrv, steps). Use these names in the metric_types filter of the other tools.",
      inputSchema: {
        date: z.string().optional().describe("YYYY-MM-DD. Defaults to yesterday (UTC)."),
      },
      annotations: readOnly,
    },
    async ({ date }) => {
      try {
        const d = date ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);
        return text({ date: d, auth_mode: authMode(), metric_types: [...metricTypes(await fetchDay(d))].sort() });
      } catch (e) {
        return fail(e);
      }
    },
  );

  return server;
}
