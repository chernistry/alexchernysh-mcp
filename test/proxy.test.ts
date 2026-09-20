import { afterEach, describe, expect, it } from "vitest";
import { mockOrigin, req, rpcOk } from "./helpers.js";
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} });
const post = (b = body, h: Record<string, string> = {}) => req("/mcp", { method: "POST", body: b, headers: { "content-type": "application/json", accept: "application/json", "cf-connecting-ip": "203.0.113.9", "mcp-protocol-version": "2025-06-18", ...h } });
let m: ReturnType<typeof mockOrigin> | undefined; afterEach(() => m?.restore());
describe("POST /mcp", () => {
  it("forwards to the origin with the edge secret, the client ip, a real user-agent, and returns the body untouched", async () => {
    m = mockOrigin(() => rpcOk(1, { tools: [] }));
    const r = await post(); expect(r.status).toBe(200); expect(await r.text()).toBe(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }));
    expect(m.calls).toHaveLength(1); const u = m.calls[0]!;
    expect(u.url).toBe("https://alexchernysh.com/mcp"); expect(u.method).toBe("POST");
    expect(u.headers.get("x-mcp-edge-secret")).toBe("test-secret"); expect(u.headers.get("x-mcp-client-ip")).toBe("203.0.113.9");
    expect(u.headers.get("user-agent")).toMatch(/^mcp\.alexchernysh\.com\/\d/); expect(u.headers.get("mcp-protocol-version")).toBe("2025-06-18");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
  it("never forwards cookies or authorization", async () => { m = mockOrigin(() => rpcOk(1, {})); await post(body, { cookie: "a=b", authorization: "Bearer x" }); expect(m.calls[0]!.headers.get("cookie")).toBeNull(); expect(m.calls[0]!.headers.get("authorization")).toBeNull(); });
  it("413 before any upstream call when the body exceeds 64 KB", async () => { m = mockOrigin(() => rpcOk(1, {})); const r = await post("x".repeat(65 * 1024)); expect(r.status).toBe(413); expect(m.calls).toHaveLength(0); });
  it("parse error → 200 JSON-RPC -32700, no upstream call", async () => { m = mockOrigin(() => rpcOk(1, {})); const r = await post("{not json"); expect(r.status).toBe(200); expect(((await r.json()) as { error: { code: number } }).error.code).toBe(-32700); expect(m.calls).toHaveLength(0); });
  it("upstream throws → 502 JSON-RPC -32000", async () => { m = mockOrigin(() => { throw new Error("boom"); }); const r = await post(); expect(r.status).toBe(502); expect(((await r.json()) as { error: { message: string } }).error.message).toMatch(/upstream/i); });
  it("upstream 5xx → 502 with the same shape", async () => { m = mockOrigin(() => new Response("<html>bad gateway</html>", { status: 502 })); const r = await post(); expect(r.status).toBe(502); expect(r.headers.get("content-type")).toContain("application/json"); });
  it("upstream 429 passes through with retry-after", async () => { m = mockOrigin(() => new Response("{}", { status: 429, headers: { "retry-after": "60" } })); const r = await post(); expect(r.status).toBe(429); expect(r.headers.get("retry-after")).toBe("60"); });
  it("rate limiter over limit → 429 before upstream", async () => { m = mockOrigin(() => rpcOk(1, {})); const worker = (await import("../src/index.js")).default; const { ctx } = await import("./helpers.js"); const env = { MCP_EDGE_SECRET: "s", MCP_RATE_LIMITER: { limit: async () => ({ success: false }) } as unknown as RateLimit }; const r = await worker.fetch(new Request("https://mcp.alexchernysh.com/mcp", { method: "POST", body, headers: { "content-type": "application/json" } }), env, ctx); expect(r.status).toBe(429); expect(m.calls).toHaveLength(0); });
});

describe("POST /mcp — the boundary holds", () => {
  it("forwards nothing beyond the four allow-listed headers plus the edge pair", async () => {
    m = mockOrigin(() => rpcOk(1, {}));
    await post(body, { "x-mcp-edge-secret": "forged", "x-mcp-client-ip": "10.0.0.1", "x-forwarded-for": "10.0.0.2", referer: "https://evil.example", origin: "https://evil.example" });
    const sent = m.calls[0]!;
    expect(sent.headers.get("x-mcp-edge-secret")).toBe("test-secret");
    expect(sent.headers.get("x-mcp-client-ip")).toBe("203.0.113.9");
    expect(sent.headers.get("x-forwarded-for")).toBeNull();
    expect(sent.headers.get("referer")).toBeNull();
  });
  it("sends no edge headers at all when the secret is unset, so neither can be spoofed", async () => {
    m = mockOrigin(() => rpcOk(1, {}));
    const worker = (await import("../src/index.js")).default; const { ctx } = await import("./helpers.js");
    const r = await worker.fetch(new Request("https://mcp.alexchernysh.com/mcp", { method: "POST", body, headers: { "content-type": "application/json", "x-mcp-edge-secret": "forged", "x-mcp-client-ip": "10.0.0.1" } }), {}, ctx);
    expect(r.status).toBe(200);
    expect(m.calls[0]!.headers.get("x-mcp-edge-secret")).toBeNull();
    expect(m.calls[0]!.headers.get("x-mcp-client-ip")).toBeNull();
  });
  it("ignores an origin variable that is not an absolute http(s) URL", async () => {
    m = mockOrigin(() => rpcOk(1, {}));
    const worker = (await import("../src/index.js")).default; const { ctx } = await import("./helpers.js");
    await worker.fetch(new Request("https://mcp.alexchernysh.com/mcp", { method: "POST", body, headers: { "content-type": "application/json" } }), { ORIGIN_MCP_URL: "javascript:alert(1)" }, ctx);
    expect(m.calls[0]!.url).toBe("https://alexchernysh.com/mcp");
  });
  it("answers an upstream redirect as an upstream failure instead of chasing it", async () => {
    m = mockOrigin(() => new Response(null, { status: 302, headers: { location: "https://evil.example/" } }));
    const r = await post();
    expect(r.status).toBe(502);
    expect(r.headers.get("location")).toBeNull();
    expect(((await r.json()) as { error: { code: number } }).error.code).toBe(-32000);
  });
  it("drops set-cookie and any other upstream header", async () => {
    m = mockOrigin(() => new Response("{}", { status: 200, headers: { "set-cookie": "a=b", "x-origin-internal": "1", "content-type": "application/json" } }));
    const r = await post();
    expect(r.headers.get("set-cookie")).toBeNull();
    expect(r.headers.get("x-origin-internal")).toBeNull();
  });
  it("clamps an unexpected upstream content-type back to application/json", async () => {
    m = mockOrigin(() => new Response("<script>alert(1)</script>", { status: 200, headers: { "content-type": "text/html" } }));
    const r = await post();
    expect(r.headers.get("content-type")).toBe("application/json");
    expect(r.headers.get("x-content-type-options")).toBe("nosniff");
  });
  it("JSON nested deeper than the limit → 200 JSON-RPC -32700, no upstream call", async () => {
    m = mockOrigin(() => rpcOk(1, {}));
    const deep = "[".repeat(40) + "]".repeat(40);
    const r = await post(deep);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { error: { code: number } }).error.code).toBe(-32700);
    expect(m.calls).toHaveLength(0);
  });
  it("a failing rate limiter fails open", async () => {
    m = mockOrigin(() => rpcOk(1, {}));
    const worker = (await import("../src/index.js")).default; const { ctx } = await import("./helpers.js");
    const env = { MCP_EDGE_SECRET: "s", MCP_RATE_LIMITER: { limit: async () => { throw new Error("limiter down"); } } as unknown as RateLimit };
    const r = await worker.fetch(new Request("https://mcp.alexchernysh.com/mcp", { method: "POST", body, headers: { "content-type": "application/json" } }), env, ctx);
    expect(r.status).toBe(200);
  });
});
