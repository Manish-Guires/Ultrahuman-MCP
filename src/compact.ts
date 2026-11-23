// Ultrahuman returns minute-level time series (heart rate, temperature, ...).
// A month of that is far too much text for Claude to read, so these helpers
// shrink long series into simple statistics. They do not assume an exact
// response shape: they walk whatever JSON comes back.

const SERIES_THRESHOLD = 48;

type Json = unknown;

function numericValue(x: Json): number | null {
  if (typeof x === "number" && Number.isFinite(x)) return x;
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const v = (x as Record<string, unknown>).value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
  }
  return null;
}

function timestampOf(x: Json): number | string | null {
  if (x && typeof x === "object" && !Array.isArray(x)) {
    const o = x as Record<string, unknown>;
    const t = o.timestamp ?? o.time ?? o.ts ?? o.start;
    if (typeof t === "number" || typeof t === "string") return t;
  }
  return null;
}

function summariseSeries(arr: Json[]): Json {
  const nums = arr.map(numericValue).filter((n): n is number => n !== null);
  if (nums.length < arr.length * 0.8) return null; // not a numeric series
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    summarised_series: true,
    points: nums.length,
    min: Math.min(...nums),
    max: Math.max(...nums),
    avg: Math.round((sum / nums.length) * 100) / 100,
    first_timestamp: timestampOf(arr[0]),
    last_timestamp: timestampOf(arr[arr.length - 1]),
  };
}

export function compact(x: Json): Json {
  if (Array.isArray(x)) {
    if (x.length > SERIES_THRESHOLD) {
      const s = summariseSeries(x);
      if (s) return s;
    }
    return x.map(compact);
  }
  if (x && typeof x === "object") {
    return Object.fromEntries(
      Object.entries(x as Record<string, unknown>).map(([k, v]) => [k, compact(v)]),
    );
  }
  return x;
}

/**
 * Keep only metric entries whose "type" is in `types` (e.g. ["sleep","hrv"]).
 * Entries without a "type" field are kept as-is.
 */
export function filterTypes(x: Json, types: string[] | undefined): Json {
  if (!types || types.length === 0) return x;
  const want = new Set(types.map((t) => t.toLowerCase()));
  const walk = (v: Json): Json => {
    if (Array.isArray(v)) {
      return v
        .filter((e) => {
          const t = (e as Record<string, unknown> | null)?.type;
          return typeof t !== "string" || want.has(t.toLowerCase());
        })
        .map(walk);
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(
        Object.entries(v as Record<string, unknown>).map(([k, val]) => [k, walk(val)]),
      );
    }
    return v;
  };
  return walk(x);
}

/** List the distinct metric "type" names found in a response. */
export function metricTypes(x: Json, found = new Set<string>()): Set<string> {
  if (Array.isArray(x)) {
    for (const e of x) {
      const t = (e as Record<string, unknown> | null)?.type;
      if (typeof t === "string") found.add(t);
      metricTypes(e, found);
    }
  } else if (x && typeof x === "object") {
    for (const v of Object.values(x as Record<string, unknown>)) metricTypes(v, found);
  }
  return found;
}
