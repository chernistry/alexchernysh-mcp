import { describe, expect, it } from "vitest";
import { req } from "./helpers.js";
describe("router", () => {
  it("GET /healthz → ok + version", async () => { const r = await req("/healthz"); expect(r.status).toBe(200); const j = (await r.json()) as { ok: boolean; version: string }; expect(j.ok).toBe(true); expect(typeof j.version).toBe("string"); });
  it("GET /nope → 404 json", async () => { const r = await req("/nope"); expect(r.status).toBe(404); expect(r.headers.get("content-type")).toContain("application/json"); });
  it("GET /mcp with text/html Accept → 303 /", async () => { const r = await req("/mcp", { headers: { accept: "text/html" } }); expect(r.status).toBe(303); expect(r.headers.get("location")).toBe("https://mcp.alexchernysh.com/"); });
  it("GET /mcp otherwise → 405 Allow: POST", async () => { const r = await req("/mcp"); expect(r.status).toBe(405); expect(r.headers.get("allow")).toBe("POST"); });
  it("every response carries the standard headers", async () => { for (const p of ["/", "/healthz", "/nope"]) { const r = await req(p); expect(r.headers.get("x-content-type-options")).toBe("nosniff"); expect(r.headers.get("strict-transport-security")).toContain("max-age=31536000"); } });
  it("the 303 redirect carries them too, although its headers are immutable", async () => { const r = await req("/mcp", { headers: { accept: "text/html" } }); expect(r.headers.get("x-content-type-options")).toBe("nosniff"); expect(r.headers.get("referrer-policy")).toBe("no-referrer"); });
  it("GET / is 200 html with its own cache-control", async () => { const r = await req("/"); expect(r.status).toBe(200); expect(r.headers.get("content-type")).toContain("text/html"); expect(r.headers.get("cache-control")).toBe("public, max-age=300"); });
  it("POST / → 405 Allow: GET, HEAD", async () => { const r = await req("/", { method: "POST" }); expect(r.status).toBe(405); expect(r.headers.get("allow")).toBe("GET, HEAD"); });
  it("GET /try is 200 html, never cached", async () => { const r = await req("/try"); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("no-store"); });
  it("DELETE /try → 405 Allow: GET, POST", async () => { const r = await req("/try", { method: "DELETE" }); expect(r.status).toBe(405); expect(r.headers.get("allow")).toBe("GET, POST"); });
  it("GET /robots.txt is text/plain and disallows the endpoint", async () => { const r = await req("/robots.txt"); expect(r.status).toBe(200); expect(r.headers.get("content-type")).toContain("text/plain"); expect(await r.text()).toContain("Disallow: /mcp"); });
  it("GET /.webmcp/bridge.js → 404 json while the bridge is not served", async () => { const r = await req("/.webmcp/bridge.js"); expect(r.status).toBe(404); expect(r.headers.get("content-type")).toContain("application/json"); });
});
