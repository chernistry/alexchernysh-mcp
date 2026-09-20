// The Worker behind mcp.alexchernysh.com.
//
// Two jobs, kept apart: render the two HTML pages (src/pages/*), and forward
// POST /mcp to the single origin the endpoint actually lives on (src/proxy.ts).
// No KV, R2, D1, Durable Object or service binding — the only bindings are a
// rate limiter and one secret, so there is nothing here to pivot on. Fonts are
// bundled as Data modules and served from /fonts/*, so a page loads no
// third-party resource.

import { forwardMcp } from "./proxy.js";
import { renderHome } from "./pages/home.js";
import { renderTry } from "./pages/try.js";
import { robotsTxt, llmsTxt, webmcpBridge } from "./discovery.js";
import { listTools } from "./origin.js";
import { withStandardHeaders } from "./limits.js";
import cormorant from "../fonts/cormorant-garamond-600.woff2";
import manrope400 from "../fonts/manrope-400.woff2";
import manrope600 from "../fonts/manrope-600.woff2";
import pkg from "../package.json" with { type: "json" };

export interface Env { MCP_RATE_LIMITER?: RateLimit; MCP_EDGE_SECRET?: string; ORIGIN_MCP_URL?: string }
export const VERSION = pkg.version;
const FONTS: Record<string, ArrayBuffer> = { "cormorant-garamond-600.woff2": cormorant, "manrope-400.woff2": manrope400, "manrope-600.woff2": manrope600 };

const json = (body: unknown, status = 200, h: Record<string, string> = {}) => withStandardHeaders(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } }));
const html = (r: { html: string; csp: string }, status = 200, cache = "public, max-age=300") => withStandardHeaders(new Response(r.html, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": cache, "content-security-policy": r.csp } }));
const wantsHtml = (r: Request) => /\btext\/html\b/.test(r.headers.get("accept") ?? "");

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url); const { pathname } = url; const t0 = Date.now();
    const log: Record<string, unknown> = { path: pathname, method: request.method };
    try {
      if (pathname === "/mcp") {
        if (request.method === "POST") return await forwardMcp(request, env, log);
        if (request.method === "GET" && wantsHtml(request)) return withStandardHeaders(Response.redirect(new URL("/", url).toString(), 303));
        return json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "This endpoint is stateless: use POST." } }, 405, { allow: "POST" });
      }
      if (pathname === "/healthz") return json({ ok: true, version: VERSION });
      if (pathname === "/") { if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405, { allow: "GET, HEAD" }); return html(await renderHome(env)); }
      if (pathname === "/try" || pathname.startsWith("/try/")) {
        if (request.method === "POST" && pathname === "/try") { const r = await renderTry(env, url, await request.formData()); return html(r, r.status, "no-store"); }
        if (request.method === "GET") { const r = await renderTry(env, url); return html(r, r.status, "no-store"); }
        return json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
      }
      if (pathname.startsWith("/fonts/")) { const f = FONTS[pathname.slice(7)]; if (!f) return json({ error: "not_found" }, 404); return withStandardHeaders(new Response(f, { headers: { "content-type": "font/woff2", "cache-control": "public, max-age=31536000, immutable" } })); }
      if (pathname === "/robots.txt") return withStandardHeaders(new Response(robotsTxt(), { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } }));
      if (pathname === "/llms.txt") { const t = await listTools(env); return withStandardHeaders(new Response(llmsTxt(t.value), { headers: { "content-type": "text/markdown; charset=utf-8", "cache-control": "public, max-age=300" } })); }
      if (pathname === "/.webmcp/bridge.js") { const b = webmcpBridge(); return b ? withStandardHeaders(new Response(b, { headers: { "content-type": "text/javascript; charset=utf-8", "cache-control": "public, max-age=86400" } })) : json({ error: "not_found" }, 404); }
      return json({ error: "not_found" }, 404);
    } finally {
      log.ms = Date.now() - t0; ctx.waitUntil(Promise.resolve(console.log(JSON.stringify(log))));
    }
  },
};
