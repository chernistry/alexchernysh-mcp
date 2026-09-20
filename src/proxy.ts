// POST /mcp → the one origin the MCP endpoint lives on.
//
// This module is the security boundary of the Worker, so every rule it
// enforces is stated here rather than spread across the router:
//
//  1. One destination. The upstream URL is a deployment variable with a
//     compile-time default; no part of the request (path, query, header,
//     body) can steer it. A variable that is not an absolute http(s) URL is
//     ignored in favour of the default, and redirects are never followed, so
//     the Worker cannot be used to reach any other host.
//  2. Size first. The body is read under a hard cap and rejected with 413
//     before it is parsed, and before any upstream call is made.
//  3. Shape second. The body must be JSON no deeper than the shared limit;
//     anything else is a JSON-RPC parse error, again with no upstream call.
//  4. Request headers are allow-listed. Only the four headers below reach the
//     origin. Cookies, Authorization, Referer, Origin, X-Forwarded-*, and any
//     client attempt to spoof the two x-mcp-* headers are dropped by
//     construction, because the outbound Headers start empty.
//  5. Response headers are allow-listed too: content-type (clamped to the
//     media types the protocol uses), cache-control, retry-after. Nothing
//     else from the origin — notably no Set-Cookie — reaches the client.
//  6. Failure is always JSON-RPC. A network error, a timeout, a redirect or a
//     5xx becomes a 502 with a JSON-RPC error body; the client never sees an
//     edge HTML error page.

import type { Env } from "./index.js";
import { VERSION } from "./version.js";
import {
  MAX_BODY_BYTES,
  readBodyWithLimit,
  parseJsonWithDepthLimit,
  jsonRpcError,
  withStandardHeaders,
  JSON_RPC_PARSE_ERROR,
  JSON_RPC_REQUEST_TOO_LARGE,
  overLimit,
  clientIp,
} from "./limits.js";

const DEFAULT_ORIGIN = "https://alexchernysh.com/mcp";
const UPSTREAM_TIMEOUT_MS = 25_000;

/** The only request headers forwarded to the origin. */
const PASS = ["content-type", "accept", "mcp-protocol-version", "accept-language"];

/** The only response media types the origin is allowed to label a body with. */
const CONTENT_TYPES = ["application/json", "text/event-stream"];

/** Caps on what the request log may take from a client-controlled envelope. */
const LOG_MAX_MESSAGES = 20;
const LOG_MAX_FIELD = 80;

const rpc = (body: unknown, status: number, h: Record<string, string> = {}) =>
  withStandardHeaders(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json", "cache-control": "no-store", ...h },
    }),
  );

/**
 * The upstream URL. A deployment variable may override the default, but only
 * with an absolute http(s) URL — anything else (a relative path, a javascript:
 * or data: URL, a typo) falls back to the default rather than being resolved
 * against something unexpected.
 */
function originUrl(env: Env): string {
  const configured = env.ORIGIN_MCP_URL;
  if (!configured) return DEFAULT_ORIGIN;
  try {
    const parsed = new URL(configured);
    if (parsed.protocol === "https:" || parsed.protocol === "http:") return parsed.toString();
  } catch {
    // fall through
  }
  return DEFAULT_ORIGIN;
}

/** Describe the JSON-RPC envelope for the request log: method, tool, client. Never the body. */
function describe(value: unknown, log: Record<string, unknown>): void {
  const messages = (Array.isArray(value) ? value : [value]).slice(0, LOG_MAX_MESSAGES);
  for (const m of messages) {
    if (!m || typeof m !== "object") continue;
    const { method, params } = m as { method?: unknown; params?: Record<string, unknown> };
    if (typeof method !== "string") continue;
    const name = method.slice(0, LOG_MAX_FIELD);
    log.rpc = log.rpc ? `${log.rpc},${name}` : name;
    const ci = params?.["clientInfo"] as { name?: unknown; version?: unknown } | undefined;
    if (method === "initialize" && ci && typeof ci.name === "string") {
      log.client = ci.name.slice(0, LOG_MAX_FIELD);
      if (typeof ci.version === "string") log.client_version = ci.version.slice(0, 40);
    }
    if (method === "tools/call" && typeof params?.["name"] === "string") {
      log.tool = (params["name"] as string).slice(0, LOG_MAX_FIELD);
    }
  }
}

/** Clamp the origin's content-type to a media type the protocol actually uses. */
function contentTypeOf(upstream: Response): string {
  const raw = upstream.headers.get("content-type");
  if (!raw) return "application/json";
  const media = raw.split(";", 1)[0]!.trim().toLowerCase();
  return CONTENT_TYPES.includes(media) ? raw : "application/json";
}

/**
 * Forwards one JSON-RPC request. Never throws: any unexpected failure is
 * reported as a 502 JSON-RPC error so a client always gets a parseable body.
 */
export async function forwardMcp(request: Request, env: Env, log: Record<string, unknown>): Promise<Response> {
  try {
    return await forward(request, env, log);
  } catch {
    log.upstream = "error";
    return rpc(jsonRpcError(null, -32000, "Upstream unavailable; retry later."), 502);
  }
}

async function forward(request: Request, env: Env, log: Record<string, unknown>): Promise<Response> {
  if (await overLimit(request, env)) {
    return rpc(
      jsonRpcError(null, -32000, "More than 60 requests per minute from this address; retry later."),
      429,
      { "retry-after": "60" },
    );
  }

  const body = await readBodyWithLimit(request, MAX_BODY_BYTES);
  if (!body.ok) {
    return rpc(jsonRpcError(null, JSON_RPC_REQUEST_TOO_LARGE, "Request body exceeds the 64 KB limit."), 413);
  }

  const parsed = parseJsonWithDepthLimit(body.text);
  if (!parsed.ok) {
    // A JSON-RPC parse error is an application-level answer, not a transport
    // failure: HTTP 200 with the error in the envelope, as the spec requires.
    return rpc(
      jsonRpcError(
        null,
        JSON_RPC_PARSE_ERROR,
        parsed.reason === "parse_error"
          ? "Parse error: request body is not valid JSON."
          : "Request JSON is nested deeper than the allowed limit.",
      ),
      200,
    );
  }
  describe(parsed.value, log);

  // Starts empty: everything the client sent is dropped unless named in PASS.
  const headers = new Headers();
  for (const h of PASS) {
    const v = request.headers.get(h);
    if (v) headers.set(h, v);
  }
  // The zone's edge rules reject requests without a real user agent.
  headers.set("user-agent", `mcp.alexchernysh.com/${VERSION}`);
  // Set last, so a client cannot spoof either: the secret proves the call came
  // from this Worker, and only then does the origin trust the client IP.
  if (env.MCP_EDGE_SECRET) {
    headers.set("x-mcp-edge-secret", env.MCP_EDGE_SECRET);
    headers.set("x-mcp-client-ip", clientIp(request));
  }

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  let upstream: Response;
  try {
    upstream = await fetch(originUrl(env), {
      method: "POST",
      headers,
      body: body.text,
      signal: ctrl.signal,
      redirect: "manual", // one destination only; never chase a Location
    });
  } catch {
    log.upstream = "error";
    return rpc(jsonRpcError(null, -32000, "Upstream unavailable; retry later."), 502);
  } finally {
    clearTimeout(timer);
  }

  log.upstream_status = upstream.status;
  // 5xx and any redirect are both origin misbehaviour as far as a client is
  // concerned: answer with the one failure shape instead of leaking either.
  if (upstream.status >= 500 || (upstream.status >= 300 && upstream.status < 400)) {
    return rpc(jsonRpcError(null, -32000, "Upstream unavailable; retry later."), 502);
  }

  const out = new Headers({ "content-type": contentTypeOf(upstream), "cache-control": "no-store" });
  const ra = upstream.headers.get("retry-after");
  if (ra) out.set("retry-after", ra);
  return withStandardHeaders(new Response(upstream.body, { status: upstream.status, headers: out }));
}
