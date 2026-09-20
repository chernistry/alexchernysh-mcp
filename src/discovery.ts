// The files an agent or a crawler reads before it reads anything else.

/** /robots.txt — the two pages are crawlable, the JSON-RPC endpoint is not. */
export function robotsTxt(): string {
  return "User-agent: *\nAllow: /\nDisallow: /mcp\nSitemap: https://mcp.alexchernysh.com/llms.txt\n";
}

/** /llms.txt — a short description plus the tool list. */
export function llmsTxt(tools: { name: string; description: string }[]): string {
  const lines = [
    "# alexchernysh mcp",
    "",
    "> Read-only MCP endpoint for alexchernysh.com: profile, projects, CV and grounded answers about Alex Chernysh.",
    "",
    "## Connect",
    "",
    "`claude mcp add --transport http alex https://mcp.alexchernysh.com/mcp`",
    "",
    "## Tools",
    "",
    ...tools.map((t) => `- \`${t.name}\`: ${t.description}`),
    "",
  ];
  return lines.join("\n");
}

/** The WebMCP bridge script, or null while the route is not served. */
export function webmcpBridge(): string | null {
  return null;
}
