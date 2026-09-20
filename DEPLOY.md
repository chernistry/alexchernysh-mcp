# Deploy, verify, roll back

## Credentials

`wrangler deploy` needs `CLOUDFLARE_API_TOKEN` with the following scopes:

- **Workers Scripts:Write** — deploy and update Worker script
- **Workers Tail:Read** — stream live logs during and after deploy
- **Account Settings:Read** — verify account configuration
- **Workers Observability:Write** — enable traces and analytics
- **Workers Routes:Write** — manage route binding on the zone

The token goes in `CLOUDFLARE_API_TOKEN` environment variable. CI takes it from the repository secret.

## Deploy

```bash
npm ci
npm test
CLOUDFLARE_API_TOKEN=… npx wrangler deploy
```

DNS: `mcp.alexchernysh.com` is a Cloudflare proxied record; the Worker route handles all requests to that hostname.

## Verify

Run the smoke tests:

```bash
bash scripts/smoke.sh
```

Or verify manually:

```bash
# Health and version
curl -s https://mcp.alexchernysh.com/healthz
# {"ok":true,"version":"0.1.0"}

# Tool list
curl -s https://mcp.alexchernysh.com/mcp \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# {"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"ask_alex","description":"…"}]}}

# Robots and sitemap
curl -s https://mcp.alexchernysh.com/robots.txt
curl -s https://mcp.alexchernysh.com/llms.txt

# Home and /try
curl -s https://mcp.alexchernysh.com/ | head -20
curl -s https://mcp.alexchernysh.com/try | head -20
```

## Roll back

```bash
CLOUDFLARE_API_TOKEN=… npx wrangler rollback
```

Cloudflare keeps the previous 10 deployments.

## Refresh snapshots

When the origin endpoint's tools or profile change:

```bash
npm run snapshots
```

This updates `data/tools.snapshot.json` and `data/profile.snapshot.json` from the live endpoint. The `llms.txt` and README tool table will reflect the new list on the next deploy.

## Worker secret: MCP_EDGE_SECRET

The `MCP_EDGE_SECRET` variable is **optional**. If set, the Worker adds two headers to every outbound request to the origin:

- `x-mcp-edge-secret: <value>` — proves the request came from the Worker, not a direct call
- `x-mcp-client-ip: <client-ip>` — the original requester's IP

If `MCP_EDGE_SECRET` is undefined, the origin falls back to rate-limiting by connection IP.

Set it with:

```bash
CLOUDFLARE_API_TOKEN=… npx wrangler secret put MCP_EDGE_SECRET
```

(Prompts for the value.)
