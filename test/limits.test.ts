import { describe, expect, it } from "vitest";
import {
  MAX_BODY_BYTES,
  MAX_JSON_DEPTH,
  jsonRpcError,
  parseJsonWithDepthLimit,
  readBodyWithLimit,
  withStandardHeaders,
} from "../src/limits.js";

const post = (body: BodyInit, headers: Record<string, string> = {}) =>
  new Request("https://mcp.alexchernysh.com/mcp", { method: "POST", body, headers }) as unknown as Request;

describe("readBodyWithLimit", () => {
  it("the cap is 64 KB", () => { expect(MAX_BODY_BYTES).toBe(64 * 1024); });

  it("accepts a body at the limit", async () => {
    const r = await readBodyWithLimit(post("x".repeat(MAX_BODY_BYTES)));
    expect(r.ok).toBe(true);
  });

  it("rejects a body over 64 KB", async () => {
    const r = await readBodyWithLimit(post("x".repeat(MAX_BODY_BYTES + 1)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(413);
  });

  it("rejects on a lying content-length before reading a byte", async () => {
    const r = await readBodyWithLimit(post("{}", { "content-length": String(MAX_BODY_BYTES + 1) }));
    expect(r.ok).toBe(false);
  });

  it("an empty body reads as empty text", async () => {
    const r = await readBodyWithLimit(new Request("https://mcp.alexchernysh.com/mcp") as unknown as Request);
    expect(r).toEqual({ ok: true, text: "" });
  });
});

describe("parseJsonWithDepthLimit", () => {
  const nest = (depth: number) => "[".repeat(depth) + "]".repeat(depth);

  it("accepts JSON at the depth limit", () => {
    expect(parseJsonWithDepthLimit(nest(MAX_JSON_DEPTH)).ok).toBe(true);
  });

  it("rejects JSON deeper than 32", () => {
    const r = parseJsonWithDepthLimit(nest(MAX_JSON_DEPTH + 2));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("depth_exceeded");
  });

  it("rejects a malformed body without throwing", () => {
    const r = parseJsonWithDepthLimit("{not json");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("parse_error");
  });

  it("an empty body parses as null", () => {
    expect(parseJsonWithDepthLimit("")).toEqual({ ok: true, value: null });
  });
});

describe("jsonRpcError", () => {
  it("has the JSON-RPC 2.0 error shape", () => {
    expect(jsonRpcError(null, -32700, "x")).toEqual({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "x" } });
  });
});

describe("withStandardHeaders", () => {
  it("sets every security header and leaves cache-control alone", () => {
    const r = withStandardHeaders(new Response("{}", { headers: { "cache-control": "public, max-age=300" } }) as unknown as Response);
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
    expect(r.headers.get("referrer-policy")).toBe("no-referrer");
    expect(r.headers.get("strict-transport-security")).toBe("max-age=31536000; includeSubDomains; preload");
    expect(r.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
    expect(r.headers.get("cross-origin-opener-policy")).toBe("same-origin");
    expect(r.headers.get("cross-origin-resource-policy")).toBe("same-origin");
    expect(r.headers.get("cache-control")).toBe("public, max-age=300");
  });

  it("copies a response whose headers are immutable", () => {
    const redirect = Response.redirect("https://mcp.alexchernysh.com/", 303) as unknown as Response;
    const r = withStandardHeaders(redirect);
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("https://mcp.alexchernysh.com/");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
});
