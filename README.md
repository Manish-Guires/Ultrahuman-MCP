# Ultrahuman MCP (hosted)

A **read-only** connector that lets Claude read your Ultrahuman ring data: sleep, HRV,
resting heart rate, recovery, movement, steps, skin temperature, VO2 max and glucose (with the M1 patch).
It can host on Vercel as a claude.ai custom connector, or run locally over stdio.

Forked from [Monasterolo21/Ultrahuman-MCP](https://github.com/Monasterolo21/Ultrahuman-MCP) (MIT) and rewritten with:

- a web (Streamable HTTP) endpoint protected by an access key, so it works from claude.ai
- date-range and metric-type tools, with long minute-level series summarised to min/avg/max
- support for both Ultrahuman access routes: a personal key, or an OAuth app
- tests (`npm test`)

Nothing here can change data in your Ultrahuman account. The only outbound hosts are
`partner.ultrahuman.com`, `auth.ultrahuman.com`, and your own Redis store (OAuth mode only).

## Tools

| Tool | What it does |
| --- | --- |
| `ultrahuman_daily_metrics` | One day's metrics (`date`, optional `metric_types`, `detailed`) |
| `ultrahuman_metrics_range` | Every day from `start_date` to `end_date` (max 31 days) |
| `ultrahuman_list_metric_types` | Which metric names exist, for use in filters |

## 1. Get access from Ultrahuman

Pick whichever Ultrahuman gives you:

- **Personal key:** email support@ultrahuman.com (or use in-app chat) from your ring account's email
  and ask for API access (an API key and Partner ID). Enter the Partner ID in the app under
  Profile → Settings → Partner ID. Then set `ULTRAHUMAN_AUTH_TOKEN` and `ULTRAHUMAN_USER_EMAIL`.
- **OAuth app:** create an app in Ultrahuman's developer dashboard. Set its redirect URL to
  `https://<your-vercel-domain>/oauth/callback`, then set `ULTRAHUMAN_CLIENT_ID` and `ULTRAHUMAN_CLIENT_SECRET`.
  Add **Upstash Redis** from the Vercel Marketplace so the rotating refresh token is saved.

## 2. Deploy on Vercel

1. Import this repository in Vercel (no build settings needed).
2. Add environment variables from `.env.example`. `MCP_ACCESS_KEY` must be a long random string,
   for example from `openssl rand -hex 32`.
3. OAuth mode only: open `https://<your-domain>/oauth/start?key=<MCP_ACCESS_KEY>` once and sign in.

## 3. Add to Claude

claude.ai → Settings → Connectors → Add custom connector → URL:

```
https://<your-domain>/mcp/<MCP_ACCESS_KEY>
```

Treat that URL like a password. To revoke access, change `MCP_ACCESS_KEY` in Vercel and redeploy.

## Local use (Claude Desktop / Claude Code)

```bash
npm install && npm run build
ULTRAHUMAN_AUTH_TOKEN=... ULTRAHUMAN_USER_EMAIL=... node dist/src/stdio.js
```
