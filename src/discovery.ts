// The files an agent or a crawler reads before it reads anything else.
//
// Stub: the router wires these routes now; the copy lands with the pages.

/** /robots.txt — the two pages are crawlable, the JSON-RPC endpoint is not. */
export function robotsTxt(): string {
  return ["User-agent: *", "Allow: /", "Allow: /try", "Disallow: /mcp", ""].join("\n");
}

/** /llms.txt — a short description plus the tool list. */
export function llmsTxt(tools: { name: string; description: string }[]): string {
  return ["# alexchernysh-mcp", "", ...tools.map((t) => `- ${t.name}: ${t.description}`), ""].join("\n");
}

/** The WebMCP bridge script, or null while the route is not served. */
export function webmcpBridge(): string | null {
  return null;
}
