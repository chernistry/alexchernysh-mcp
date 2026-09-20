import { afterEach, describe, expect, it } from "vitest";
import { listTools, callTool } from "../src/origin.js";
import { env, mockOrigin } from "./helpers.js";

let m: ReturnType<typeof mockOrigin> | undefined;
afterEach(() => m?.restore());

const toolsOk = () =>
  new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "ask_alex", description: "d", inputSchema: {} }] } }), {
    headers: { "content-type": "application/json" },
  });

describe("listTools", () => {
  it("falls back to the bundled snapshot when the origin does not answer", async () => {
    m = mockOrigin(() => { throw new Error("origin down"); });
    const r = await listTools(env);
    expect(r.source).toBe("snapshot");
    expect(r.ageSeconds).toBe(-1);
    expect(r.value.map((t) => t.name)).toEqual(["ask_alex", "get_profile", "list_projects", "get_cv"]);
  });

  it("reports a live read with a measured latency", async () => {
    m = mockOrigin(() => toolsOk());
    const r = await listTools(env);
    expect(r.source).toBe("live");
    expect(typeof r.latencyMs).toBe("number");
    expect(r.value).toHaveLength(1);
    expect(m.calls[0]!.url).toBe("https://alexchernysh.com/mcp");
    expect(m.calls[0]!.headers.get("x-mcp-edge-secret")).toBe("test-secret");
    expect(m.calls[0]!.headers.get("accept")).toBe("application/json, text/event-stream");
  });

  it("treats an origin 5xx as no answer", async () => {
    m = mockOrigin(() => new Response("nope", { status: 503 }));
    const r = await listTools(env);
    expect(r.source).toBe("snapshot");
  });
});

describe("callTool", () => {
  it("returns the wire exchange alongside the value", async () => {
    m = mockOrigin(() => new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { content: [] } }), { headers: { "content-type": "application/json" } }));
    const r = await callTool(env, "get_profile", {});
    expect(r.source).toBe("live");
    expect(r.request).toEqual({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "get_profile", arguments: {} } });
    expect(r.response).toEqual(r.value);
  });

  it("answers a dead origin with a JSON-RPC error rather than throwing", async () => {
    m = mockOrigin(() => { throw new Error("origin down"); });
    const r = await callTool(env, "list_projects", {});
    expect(r.source).toBe("snapshot");
    expect((r.value as { error: { code: number } }).error.code).toBe(-32000);
  });
});

describe("origin answers framed as SSE", () => {
  it("are parsed from the data: line rather than treated as an outage", async () => {
    m = mockOrigin(
      () =>
        new Response('event: message\ndata: {"jsonrpc":"2.0","id":2,"result":{"content":[{"type":"text","text":"hi"}]}}\n\n', {
          headers: { "content-type": "text/event-stream" },
        }),
    );
    const r = await callTool(env, "get_cv", {});
    expect(r.source).toBe("live");
    expect((r.value as { result: { content: { text: string }[] } }).result.content[0]!.text).toBe("hi");
  });

  it("carries the caller's address when one is given, and the page identity otherwise", async () => {
    m = mockOrigin(() => new Response(JSON.stringify({ jsonrpc: "2.0", id: 2, result: {} }), { headers: { "content-type": "application/json" } }));
    await callTool(env, "get_cv", {}, { clientIp: "198.51.100.4" });
    await callTool(env, "get_cv", {});
    expect(m.calls[0]!.headers.get("x-mcp-client-ip")).toBe("198.51.100.4");
    expect(m.calls[1]!.headers.get("x-mcp-client-ip")).toBe("edge-page");
  });
});
