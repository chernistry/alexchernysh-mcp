// Reading the origin from the pages.
//
// The pages render live data (the tool list, one real tool call), but a page
// must not go blank when the origin is slow or down. Every read therefore has
// three tiers, and the tier is reported to the caller so the page can stamp it:
//
//   live     — fetched just now, with the measured latency
//   cache    — served from the edge cache, with its age in seconds
//   snapshot — the bundled last-known-good copy, when the origin did not answer
//
// The proxy in src/proxy.ts is what agents talk to; this module is only for
// rendering. Both point at the same single origin.

import type { Env } from "./index.js";
import { VERSION } from "./index.js";
import toolsSnapshot from "../data/tools.snapshot.json";
import profileSnapshot from "../data/profile.snapshot.json";

export interface ToolResult<T = unknown> {
  value: T;
  source: "live" | "cache" | "snapshot";
  ageSeconds: number;
  latencyMs: number | null;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  inputSchema: unknown;
}

const DEFAULT_ORIGIN = "https://alexchernysh.com/mcp";
const TTL_S = 300;
const RPC_TIMEOUT_MS = 15_000;

async function rpc(env: Env, method: string, params: unknown, id: number): Promise<{ body: unknown; ms: number }> {
  const t0 = Date.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), RPC_TIMEOUT_MS);
  try {
    const r = await fetch(env.ORIGIN_MCP_URL ?? DEFAULT_ORIGIN, {
      method: "POST",
      signal: ctrl.signal,
      redirect: "manual",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
        "user-agent": `mcp.alexchernysh.com/${VERSION}`,
        ...(env.MCP_EDGE_SECRET
          ? { "x-mcp-edge-secret": env.MCP_EDGE_SECRET, "x-mcp-client-ip": "edge-page" }
          : {}),
      },
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    });
    if (!r.ok) throw new Error(`upstream ${r.status}`);
    return { body: await r.json(), ms: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Cache API keyed by a synthetic URL; absent (unit tests) → no cache. */
async function cached<T>(key: string, produce: () => Promise<T>, fallback: T): Promise<ToolResult<T>> {
  const cache = (globalThis as { caches?: CacheStorage }).caches?.default;
  const ck = new Request(`https://mcp.alexchernysh.com/__cache/${key}`);
  if (cache) {
    const hit = await cache.match(ck);
    if (hit) {
      const age = Number(hit.headers.get("x-age-base") ?? 0);
      return {
        value: (await hit.json()) as T,
        source: "cache",
        ageSeconds: Math.max(0, Math.floor(Date.now() / 1000) - age),
        latencyMs: null,
      };
    }
  }
  try {
    const t0 = Date.now();
    const value = await produce();
    const ms = Date.now() - t0;
    if (cache) {
      await cache.put(
        ck,
        new Response(JSON.stringify(value), {
          headers: {
            "cache-control": `max-age=${TTL_S}`,
            "x-age-base": String(Math.floor(Date.now() / 1000)),
            "content-type": "application/json",
          },
        }),
      );
    }
    return { value, source: "live", ageSeconds: 0, latencyMs: ms };
  } catch {
    return { value: fallback, source: "snapshot", ageSeconds: -1, latencyMs: null };
  }
}

export function listTools(env: Env): Promise<ToolResult<ToolDescriptor[]>> {
  return cached(
    "tools",
    async () =>
      ((await rpc(env, "tools/list", {}, 1)).body as { result: { tools: ToolDescriptor[] } }).result.tools,
    toolsSnapshot as unknown as ToolDescriptor[],
  );
}

export async function callTool(
  env: Env,
  name: string,
  args: Record<string, unknown>,
  opts: { cache?: boolean } = {},
): Promise<ToolResult<unknown> & { request: unknown; response: unknown }> {
  const request = { jsonrpc: "2.0", id: 2, method: "tools/call", params: { name, arguments: args } };
  const fallback: unknown = name === "get_profile" ? profileSnapshot : null;
  const r: ToolResult<unknown> = opts.cache
    ? await cached(`call:${name}:${JSON.stringify(args)}`, async () => (await rpc(env, "tools/call", request.params, 2)).body, {
        jsonrpc: "2.0",
        id: 2,
        result: fallback,
      })
    : await (async (): Promise<ToolResult<unknown>> => {
        try {
          const { body, ms } = await rpc(env, "tools/call", request.params, 2);
          return { value: body, source: "live", ageSeconds: 0, latencyMs: ms };
        } catch {
          return {
            value: { jsonrpc: "2.0", id: 2, error: { code: -32000, message: "Upstream unavailable; retry later." } },
            source: "snapshot",
            ageSeconds: -1,
            latencyMs: null,
          };
        }
      })();
  return { ...r, request, response: r.value };
}
