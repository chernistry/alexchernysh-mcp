// GET/POST /try — the tool console.
//
// `src/pages/shell.ts` is still T2's stub: `page()` ignores its `body`/
// `script` and always returns a fixed placeholder, regardless of what this
// page hands it. That means nothing this module renders can reach an
// assertion through the real router unless the test stands in a working
// (still unstyled) `page()` for the duration of the test file — so this
// file mocks only `page` (via `vi.mock` + `importOriginal`, keeping the
// real `escapeHtml`) rather than touching `src/pages/shell.ts`, which is
// off limits here. The mock is a faithful, unstyled echo of
// {title, description, body, script} — it does not invent content this
// module did not already produce, and no assertion below depends on any
// styling. Once T2's real shell lands, this mock becomes redundant but
// harmless; drop it then.
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../src/pages/shell.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/pages/shell.js")>();
  return {
    ...actual,
    page: (opts: { title: string; description: string; path: string; body: string; script?: string }) => ({
      html: `<!doctype html><html><head><title>${actual.escapeHtml(opts.title)}</title><meta name="description" content="${actual.escapeHtml(opts.description)}"></head><body data-path="${opts.path}">${opts.body}${opts.script ? `<script>${opts.script}</script>` : ""}</body></html>`,
      csp: "default-src 'none'; script-src 'self'; connect-src 'self'",
    }),
  };
});

const { req, mockOrigin, rpcOk } = await import("./helpers.js");

const TOOLS = [
  {
    name: "ask_alex",
    description: "Ask a question about Alex Chernysh.",
    inputSchema: {
      type: "object",
      properties: { question: { type: "string", minLength: 3, maxLength: 2000 } },
      required: ["question"],
    },
  },
  { name: "get_profile", description: "Structured professional profile.", inputSchema: { type: "object", properties: {} } },
  { name: "list_projects", description: "Featured and additional projects.", inputSchema: { type: "object", properties: {} } },
  { name: "get_cv", description: "Link to the downloadable CV.", inputSchema: { type: "object", properties: {} } },
];

/** Answers tools/list with TOOLS and tools/call per the given options. */
function originHandler(opts: { result?: unknown; error?: { code: number; message: string } } = {}) {
  return async (request: Request) => {
    const body = (await request.json()) as { id: number; method: string };
    if (body.method === "tools/list") return rpcOk(body.id, { tools: TOOLS });
    if (body.method === "tools/call") {
      if (opts.error) {
        return new Response(JSON.stringify({ jsonrpc: "2.0", id: body.id, error: opts.error }), {
          headers: { "content-type": "application/json" },
        });
      }
      return rpcOk(body.id, opts.result ?? { content: [{ type: "text", text: "ok" }] });
    }
    return new Response("not found", { status: 404 });
  };
}

let m: ReturnType<typeof mockOrigin> | undefined;
afterEach(() => m?.restore());

describe("GET /try", () => {
  it("200 with a tool <select> listing all four tools", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain('<select name="tool"');
    for (const t of TOOLS) expect(html).toContain(`value="${t.name}"`);
  });

  it("is never cached", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });

  it("does not execute anything (no result section)", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    const html = await r.text();
    expect(html).not.toContain('id="result"');
  });

  it("shows a curl line under the form", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    const html = await r.text();
    expect(html).toContain('class="copy"');
    expect(html).toContain("curl -s https://mcp.alexchernysh.com/mcp");
  });

  it("embeds exactly one executable script alongside the non-executable tools data island", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    const html = await r.text();
    const totalScripts = (html.match(/<script/g) ?? []).length;
    const dataIslands = (html.match(/<script type="application\/json"/g) ?? []).length;
    expect(dataIslands).toBe(1);
    expect(totalScripts - dataIslands).toBe(1);
    expect(html).toContain('<script type="application/json" id="tools">');
  });

  it("the one inline script embeds buildCall verbatim, for the client fetch to /mcp", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try");
    const html = await r.text();
    expect(html).toMatch(/function buildCall\s*\(/);
    expect(html).toContain('fetch("/mcp"');
    expect(html).toContain("history.replaceState");
  });
});

describe("GET /try/<tool>", () => {
  it("ask_alex shows a <textarea name=\"question\">, required", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try/ask_alex");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('<textarea id="f-question" name="question"');
    expect(html).toContain("required");
  });

  it("get_profile executes server-side: data-source=live and the pretty response", async () => {
    m = mockOrigin(
      originHandler({ result: { content: [{ type: "text", text: "Alex Chernysh" }], structuredContent: { name: "Alex Chernysh" } } }),
    );
    const r = await req("/try/get_profile");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('data-source="live"');
    expect(html).toContain('<div class="verdict ok">ok</div>');
    // The pretty (indented) response is escaped for HTML — quotes become
    // &quot; — so assert on content that survives escaping unchanged.
    expect(html).toContain("structuredContent");
    expect(html).toContain("Alex Chernysh");
    expect(html).toMatch(/<pre class="response">[\s\S]*Alex Chernysh[\s\S]*<\/pre>/);
  });

  it("an origin error is rendered under class=\"verdict error\", never hidden", async () => {
    m = mockOrigin(originHandler({ error: { code: -32000, message: "question is required" } }));
    const r = await req("/try/ask_alex?question=hi");
    expect(r.status).toBe(200);
    const html = await r.text();
    expect(html).toContain('class="verdict error"');
    expect(html).toContain("question is required");
  });

  it("unknown tool → 404 html, through the same shell", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try/does_not_exist");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("text/html");
    const html = await r.text();
    expect(html).toContain("Tool not found");
  });

  it("args over 64 KB → 413", async () => {
    m = mockOrigin(originHandler());
    const hugeQuestion = "q".repeat(70_000);
    const r = await req(`/try/ask_alex?question=${hugeQuestion}`);
    expect(r.status).toBe(413);
    const html = await r.text();
    expect(html).toContain("too large");
  });

  it("is never cached even when it executes", async () => {
    m = mockOrigin(originHandler());
    const r = await req("/try/get_profile");
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});

describe("POST /try", () => {
  it("tool=get_profile executes and answers 303 toward the /try/get_profile permalink", async () => {
    m = mockOrigin(originHandler({ result: { content: [] } }));
    const body = new URLSearchParams({ tool: "get_profile" });
    const r = await req("/try", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(r.status).toBe(303);
    const html = await r.text();
    expect(html).toContain("/try/get_profile");
  });

  it("unknown tool → 404 rather than executing anything", async () => {
    m = mockOrigin(originHandler());
    const body = new URLSearchParams({ tool: "does_not_exist" });
    const r = await req("/try", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(r.status).toBe(404);
  });

  it("is never cached", async () => {
    m = mockOrigin(originHandler({ result: { content: [] } }));
    const body = new URLSearchParams({ tool: "get_profile" });
    const r = await req("/try", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    expect(r.headers.get("cache-control")).toBe("no-store");
  });
});
