# alexchernysh-mcp

Stateless, read-only MCP endpoint at **https://mcp.alexchernysh.com** that serves information about Alex Chernysh — profile, projects, CV and grounded answers from the published site. No account, no key, nothing stored.

```
claude mcp add --transport http alex https://mcp.alexchernysh.com/mcp
```

## What it does

| Tool | Result |
|---|---|
| `ask_alex` | Answer a question about Alex Chernysh — background, projects, Bernstein, or working style. Grounded in published site content; declines questions it has no source for. |
| `get_profile` | Structured professional profile: identity, positioning, stack, and capabilities. |
| `list_projects` | Featured and additional projects, with short descriptions and links. |
| `get_cv` | Link to the downloadable CV/résumé plus a short text summary. |

## Configuration in `mcp.json`

```json
{
  "mcpServers": {
    "alex": {
      "type": "stdio",
      "command": "npx",
      "args": ["@modelcontextprotocol/server-stdio"],
      "env": {
        "MCP_ENDPOINT": "https://mcp.alexchernysh.com/mcp"
      }
    }
  }
}
```

Or with Claude Code:

```bash
claude mcp add --transport http alex https://mcp.alexchernysh.com/mcp
```

## Try it online

Paste a question or tool name at [/try](https://mcp.alexchernysh.com/try).

## How it works

The Worker sits in front of the site's own `/mcp` endpoint. The Worker is **stateless**: no session state, no cache other than HTTP semantics, no client tracking. Every request is independent.

The site itself loads **zero** third-party resources — no Google Fonts, no analytics, no tracking pixels. The browser never sees a third-party connection, and the origin never learns who asked.

## Limits

| Limit | Value |
|---|---|
| Request body | 64 KB |
| Rate | 60 requests/minute per IP address |
| Timeout | 25 seconds upstream |

The rate limit fails open — if the limiter is unavailable, the request proceeds.

## Licence

Apache-2.0. See [LICENSE](LICENSE).

## Development

```bash
npm install
npm test          # outbound-host check + vitest
npm run typecheck
npm run dev       # wrangler dev
```

Deploying: see [DEPLOY.md](DEPLOY.md).
