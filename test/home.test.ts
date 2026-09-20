import { afterEach, describe, expect, it } from "vitest";
import { mockOrigin, req, rpcOk } from "./helpers.js";
const tools = [{ name: "ask_alex", description: "Ask a question about Alex Chernysh.", inputSchema: { type: "object", properties: { question: { type: "string" } }, required: ["question"] } }, { name: "get_profile", description: "Structured professional profile.", inputSchema: { type: "object", properties: {} } }, { name: "list_projects", description: "Projects.", inputSchema: { type: "object", properties: {} } }, { name: "get_cv", description: "CV link.", inputSchema: { type: "object", properties: {} } }];
let m: ReturnType<typeof mockOrigin> | undefined; afterEach(() => m?.restore());
describe("GET /", () => {
  it("renders the install line, the live tools table and one live tool call", async () => {
    m = mockOrigin(async (r) => { const b = await r.json() as { method: string; id: number }; return b.method === "tools/list" ? rpcOk(b.id, { tools }) : rpcOk(b.id, { content: [{ type: "text", text: JSON.stringify({ name: "Alex Chernysh", positioning: "AI systems that hold up in production." }) }] }); });
    const r = await req("/"); expect(r.status).toBe(200); expect(r.headers.get("cache-control")).toBe("public, max-age=300");
    const body = await r.text();
    expect(body).toContain("claude mcp add --transport http alex https://mcp.alexchernysh.com/mcp");
    for (const t of tools) expect(body).toContain(`<td>${t.name}</td>`);
    expect(body).toContain('data-source="live"'); expect(body).toContain("Point your agent at me.");
    expect(body).not.toMatch(/https?:\/\/(fonts\.googleapis|fonts\.gstatic|cdn\.|unpkg|jsdelivr)/); expect(body).not.toContain("alexchernysh.com/mcp\"");  // origin url never shown
    expect(body).toContain('<meta name="color-scheme" content="light dark">');
  });
  it("still renders from the snapshot when the origin is down", async () => { m = mockOrigin(() => { throw new Error("down"); }); const r = await req("/"); expect(r.status).toBe(200); const b = await r.text(); expect(b).toContain('data-source="snapshot"'); expect(b).toContain("<td>get_profile</td>"); });
  it("is under 40 KB", async () => { m = mockOrigin(async (r) => rpcOk((await r.json() as {id:number}).id, { tools })); const b = await (await req("/")).text(); expect(new TextEncoder().encode(b).length).toBeLessThan(40 * 1024); });
});

describe("GET / — shape", () => {
  const live = () => mockOrigin(async (r) => { const b = await r.json() as { method: string; id: number }; return b.method === "tools/list" ? rpcOk(b.id, { tools }) : rpcOk(b.id, { content: [{ type: "text", text: "ok" }] }); });

  it("loads only fonts this Worker serves", async () => {
    m = live(); const b = await (await req("/")).text();
    const urls = [...b.matchAll(/url\(([^)]+)\)/g)].map((x) => x[1]!);
    expect(urls.length).toBe(3);
    for (const u of urls) expect(u.startsWith("/fonts/")).toBe(true);
  });

  it("follows the system colour scheme and offers no toggle", async () => {
    m = live(); const b = await (await req("/")).text();
    expect(b).toContain("@media (prefers-color-scheme:dark)");
    expect(b).toContain("@media (prefers-reduced-motion:reduce)");
    expect(b.toLowerCase()).not.toContain("data-theme");
  });

  it("stamps the tool call and the exchange with where the answer came from", async () => {
    m = live(); const b = await (await req("/")).text();
    expect(b).toMatch(/<section class="exchange" data-source="(live|cache|snapshot)">/);
    expect(b).toContain('<span class="label">request</span>');
    expect(b).toContain('<span class="label">response</span>');
    expect(b).toContain("get_profile");
  });

  it("shows the three install commands and the limits line", async () => {
    m = live(); const b = await (await req("/")).text();
    expect(b).toContain("claude code"); expect(b).toContain("mcp.json"); expect(b).toContain("curl");
    expect(b).toContain("60 requests/min · 64 kb body · stateless");
    expect(b).toContain('role="tablist"');
    expect((b.match(/ role="tab"/g) ?? []).length).toBe(3);   // the script's own [role="tab"] selector has no leading space
    expect((b.match(/ role="tabpanel"/g) ?? []).length).toBe(3);
  });

  it("truncates a long response and points at the console for the rest", async () => {
    m = mockOrigin(async (r) => { const b = await r.json() as { method: string; id: number }; return b.method === "tools/list" ? rpcOk(b.id, { tools }) : rpcOk(b.id, { rows: Array.from({ length: 400 }, (_, i) => `row ${i}`) }); });
    const b = await (await req("/")).text();
    expect(b).toContain('class="more"');
    expect(b).toContain('href="/try/get_profile"');
    const pre = b.split('<div class="pane out"')[1]!.split("</pre>")[0]!;
    expect(pre.split("\n").length).toBeLessThanOrEqual(62);
  });

  it("carries the canonical url, the markdown alternate and an inline favicon", async () => {
    m = live(); const b = await (await req("/")).text();
    expect(b).toContain('<link rel="canonical" href="https://mcp.alexchernysh.com/">');
    expect(b).toContain('<link rel="alternate" type="text/markdown" href="/llms.txt">');
    expect(b).toContain('<link rel="icon" href="data:image/svg+xml,');
  });
});
