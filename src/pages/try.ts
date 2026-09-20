// GET/POST /try — the schema-driven tool console.
//
// Three ways in:
//   GET  /try                browse — form for the selected tool (?tool=,
//                             default get_profile), never executes
//   GET  /try/<tool>?<args>  the permalink — form prefilled *and* already
//                             executed server-side, so the URL alone
//                             reproduces a result
//   POST /try                the no-JS fallback — executes and answers 303
//                             to the permalink, so a reload never re-submits
//
// One `buildCall` builds the JSON-RPC "tools/call" envelope; its source is
// embedded verbatim (via `.toString()`) into the page's single inline
// script, so the request a browser sends directly from the page can never
// drift in shape from the one rendered here.

import type { Env } from "../index.js";
import { page, escapeHtml, navBar, footer } from "./shell.js";
import { listTools, callTool, type ToolDescriptor } from "../origin.js";
import { MAX_BODY_BYTES, overLimit, clientIp } from "../limits.js";

const PUBLIC_MCP_URL = "https://mcp.alexchernysh.com/mcp";
const DEFAULT_TOOL = "get_profile";

interface JsonSchemaProp {
  type?: string;
  description?: string;
  maxLength?: number;
}

interface ToolInputSchema {
  properties?: Record<string, JsonSchemaProp>;
  required?: string[];
}

type RenderResult = { html: string; csp: string; status: number; location?: string };

/**
 * The one JSON-RPC "tools/call" envelope. Its source (via `.toString()`) is
 * embedded verbatim in the page's inline script, so the request a browser
 * sends directly to /mcp is byte-identical in shape to the one built here
 * for the curl line and the server-side execution.
 */
function buildCall(tool: string, args: Record<string, unknown>): unknown {
  return { jsonrpc: "2.0", id: 1, method: "tools/call", params: { name: tool, arguments: args } };
}

function schemaOf(tool: ToolDescriptor): ToolInputSchema {
  return (tool.inputSchema ?? {}) as ToolInputSchema;
}

/** The permalink for a tool + the args that were actually sent to it. */
function permalink(tool: string, args: Record<string, unknown>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(args)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    qs.set(k, v === true ? "1" : String(v));
  }
  const q = qs.toString();
  return `/try/${encodeURIComponent(tool)}${q ? `?${q}` : ""}`;
}

/** Approximate wire size of a submitted form: sum of every key + string/blob value. */
function formDataByteLength(form: FormData): number {
  const enc = new TextEncoder();
  let total = 0;
  for (const [k, v] of form.entries()) {
    total += enc.encode(k).length;
    total += typeof v === "string" ? enc.encode(v).length : v.size;
  }
  return total;
}

/** Non-null when the origin's response is a JSON-RPC error or a tool-level isError. */
function describeError(body: unknown): string | null {
  const b = body as
    | { error?: { message?: string }; result?: { isError?: boolean; content?: { type?: string; text?: string }[] } }
    | null
    | undefined;
  if (b?.error?.message) return b.error.message;
  if (b?.result?.isError) {
    const texts = (b.result.content ?? [])
      .filter((c) => c?.type === "text" && typeof c.text === "string")
      .map((c) => c.text as string);
    return texts.length ? texts.join(" ") : "The tool reported an error.";
  }
  return null;
}

function fieldHtml(name: string, prop: JsonSchemaProp, required: boolean, value: string | undefined): string {
  const id = `f-${name}`;
  const nameAttr = escapeHtml(name);
  const label = `<label for="${id}">${nameAttr}${required ? " *" : ""}</label>`;
  const type = prop.type ?? "string";
  const req = required ? " required" : "";

  if (type === "boolean") {
    const checked = value === "1" || value === "true" || value === "on";
    return `<div class="field"><label for="${id}"><input type="checkbox" id="${id}" name="${nameAttr}"${checked ? " checked" : ""}> ${nameAttr}${required ? " *" : ""}</label></div>`;
  }

  const v = value !== undefined ? escapeHtml(value) : "";
  const maxlen = typeof prop.maxLength === "number" ? ` maxlength="${prop.maxLength}"` : "";

  if (type === "number" || type === "integer") {
    return `<div class="field">${label}<input type="number" id="${id}" name="${nameAttr}" value="${v}"${req}></div>`;
  }

  const useTextarea = name === "question" || (typeof prop.maxLength === "number" && prop.maxLength > 200);
  if (useTextarea) {
    return `<div class="field">${label}<textarea id="${id}" name="${nameAttr}"${req}${maxlen}>${v}</textarea></div>`;
  }
  return `<div class="field">${label}<input type="text" id="${id}" name="${nameAttr}" value="${v}"${req}${maxlen}></div>`;
}

function resultHtml(r: { source: string; latencyMs: number | null; request: unknown; response: unknown }): string {
  const message = describeError(r.response);
  const isError = message !== null;
  const pill = isError ? `error — ${escapeHtml(message)}` : "ok";
  return `
<section class="result" id="result" data-source="${escapeHtml(r.source)}">
  <div class="verdict ${isError ? "error" : "ok"}">${pill}</div>
  <p class="meta timing">latency: ${r.latencyMs !== null ? `${r.latencyMs} ms` : "n/a"} &middot; source: ${escapeHtml(r.source)}</p>
  <pre class="request">${escapeHtml(JSON.stringify(r.request, null, 2))}</pre>
  <pre class="response">${escapeHtml(JSON.stringify(r.response, null, 2))}</pre>
</section>`;
}

/**
 * The page's single executable script. It embeds `buildCall` verbatim (so
 * the client-sent envelope can never drift from the server's), reads the
 * schema of the selected tool from the `#tools` JSON data island (data, not
 * executable), posts directly to /mcp on submit, and replaces the URL with
 * the permalink once a result comes back. The "Change tool" button carries
 * `formmethod="get"` so it is left to navigate normally, un-intercepted.
 */
function scriptSrc(): string {
  return `(function () {
  ${buildCall.toString()}
  function esc(s) { return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
  var dataEl = document.getElementById("tools");
  var toolsData = dataEl ? JSON.parse(dataEl.textContent) : [];
  var form = document.getElementById("try-form");
  if (!form) return;
  form.addEventListener("submit", function (ev) {
    var submitter = ev.submitter;
    if (submitter && submitter.getAttribute("formmethod") === "get") return;
    ev.preventDefault();
    var fd = new FormData(form);
    var tool = String(fd.get("tool") || "");
    var schema = null;
    for (var i = 0; i < toolsData.length; i++) { if (toolsData[i].name === tool) { schema = toolsData[i].inputSchema; break; } }
    var props = (schema && schema.properties) || {};
    var args = {};
    for (var name in props) {
      if (!Object.prototype.hasOwnProperty.call(props, name)) continue;
      var type = props[name].type;
      if (type === "boolean") { args[name] = fd.has(name); }
      else { var raw = fd.get(name); if (raw !== null && raw !== "") { args[name] = (type === "number" || type === "integer") ? Number(raw) : String(raw); } }
    }
    var call = buildCall(tool, args);
    fetch("/mcp", { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(call) })
      .then(function (r) { return r.json().then(function (body) { return body; }); })
      .then(function (body) {
        renderResult(call, body);
        replaceUrl(tool, args);
      })
      .catch(function () {});
  });
  function renderResult(call, body) {
    var el = document.getElementById("result");
    if (!el) return;
    var err = body && (body.error || (body.result && body.result.isError));
    var message = err ? (body.error ? body.error.message : "The tool reported an error.") : null;
    el.setAttribute("data-source", "live");
    el.innerHTML = "<div class=\\"verdict " + (err ? "error" : "ok") + "\\">" + (err ? "error \\u2014 " + esc(message) : "ok") + "</div>" +
      "<pre class=\\"request\\">" + esc(JSON.stringify(call, null, 2)) + "</pre>" +
      "<pre class=\\"response\\">" + esc(JSON.stringify(body, null, 2)) + "</pre>";
  }
  function replaceUrl(tool, args) {
    var qs = new URLSearchParams();
    for (var k in args) {
      if (!Object.prototype.hasOwnProperty.call(args, k)) continue;
      var v = args[k];
      if (v === false || v === "" || v === undefined || v === null) continue;
      qs.set(k, v === true ? "1" : String(v));
    }
    var q = qs.toString();
    var url = "/try/" + encodeURIComponent(tool) + (q ? "?" + q : "");
    history.replaceState(null, "", url);
  }
})();`;
}

function shellPage(status: number, bodyHtml: string): RenderResult {
  const { html, csp } = page({
    title: "Try it — mcp.alexchernysh.com",
    description: "Pick a tool, fill the arguments, see exactly what goes over the wire.",
    path: "/try",
    body: bodyHtml,
    script: scriptSrc(),
  });
  return { html, csp, status };
}

function notFoundPage(tools: ToolDescriptor[]): RenderResult {
  const names = tools.map((t) => escapeHtml(t.name)).join(", ");
  return shellPage(
    404,
    `${navBar("/try")}<main class="wrap try"><h1>Tool not found.</h1><p class="lede">Available tools: ${names || "none"}.</p><p><a href="/try">Back to /try</a></p></main>${footer()}`,
  );
}

function rateLimitedPage(): RenderResult {
  return shellPage(
    429,
    `${navBar("/try")}<main class="wrap try"><h1>Slow down.</h1><p class="lede">This address has used its 60 requests for the minute. Wait a moment and try again.</p><p><a href="/try">Back to /try</a></p></main>${footer()}`,
  );
}

function tooLargePage(): RenderResult {
  return shellPage(
    413,
    `${navBar("/try")}<main class="wrap try"><h1>Arguments too large.</h1><p class="lede">The arguments exceed the 64 KB limit accepted by this console.</p><p><a href="/try">Back to /try</a></p></main>${footer()}`,
  );
}

export async function renderTry(env: Env, url: URL, form?: FormData, request?: Request): Promise<RenderResult> {
  const toolsResult = await listTools(env);
  const tools = toolsResult.value;

  const isPost = form !== undefined;
  const seg = url.pathname === "/try" ? null : decodeURIComponent(url.pathname.slice("/try/".length));
  const isPermalink = !!seg;

  const toolName = isPost
    ? String(form!.get("tool") ?? DEFAULT_TOOL)
    : isPermalink
      ? seg!
      : (url.searchParams.get("tool") ?? DEFAULT_TOOL);

  const tool = tools.find((t) => t.name === toolName);
  if (!tool) return notFoundPage(tools);

  const rawSize = isPost ? formDataByteLength(form!) : new TextEncoder().encode(url.search).length;
  if (rawSize > MAX_BODY_BYTES) return tooLargePage();

  const schema = schemaOf(tool);
  const properties = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const args: Record<string, unknown> = {};
  const values: Record<string, string> = {};
  for (const [name, prop] of Object.entries(properties)) {
    if (prop.type === "boolean") {
      const on = isPost ? form!.has(name) : url.searchParams.has(name);
      args[name] = on;
      if (on) values[name] = "1";
    } else {
      const raw = isPost ? form!.get(name) : url.searchParams.get(name);
      if (typeof raw === "string" && raw !== "") {
        values[name] = raw;
        args[name] = prop.type === "number" || prop.type === "integer" ? Number(raw) : raw;
      }
    }
  }

  const shouldExecute = isPost || isPermalink;
  // Executing a tool here spends the same origin budget as POST /mcp, so it
  // sits behind the same per-IP bucket and reaches the origin as the visitor.
  if (shouldExecute && request && (await overLimit(request, env))) return rateLimitedPage();
  const result = shouldExecute
    ? await callTool(env, tool.name, args, { clientIp: request ? clientIp(request) : undefined })
    : null;

  const fieldsHtml = Object.entries(properties)
    .map(([name, prop]) => fieldHtml(name, prop, required.has(name), values[name]))
    .join("\n");

  const toolOptions = tools
    .map(
      (t) =>
        `<option value="${escapeHtml(t.name)}"${t.name === tool.name ? " selected" : ""}>${escapeHtml(t.name)}</option>`,
    )
    .join("");

  const curl = `curl -s ${PUBLIC_MCP_URL} -H 'content-type: application/json' -H 'accept: application/json, text/event-stream' -d '${JSON.stringify(buildCall(tool.name, args))}'`;

  // Data, not executable: escape "<" so a tool description containing
  // "</script" can never terminate the element early.
  const toolsJson = JSON.stringify(tools).replace(/</g, "\\u003c");

  const bodyHtml = `${navBar("/try")}<main class="wrap try">
<h1>Run a tool.</h1>
<p class="lede">Pick a tool, fill the arguments, see exactly what goes over the wire.</p>
<form method="post" action="/try" id="try-form">
  <div class="field">
    <label for="f-tool">tool</label>
    <select name="tool" id="f-tool">${toolOptions}</select>
  </div>
  ${fieldsHtml}
  <div class="actions">
    <button class="btn" type="submit">Run</button>
    <button class="btn ghost" type="submit" formmethod="get" formaction="/try">Change tool</button>
  </div>
</form>
<p class="curl"><code>${escapeHtml(curl)}</code></p>
${result ? resultHtml({ source: result.source, latencyMs: result.latencyMs, request: result.request, response: result.response }) : ""}
<script type="application/json" id="tools">${toolsJson}</script>
</main>${footer()}`;

  if (isPost) {
    // A real 303: the router forwards `location`, so a browser lands on the
    // permalink. The body still carries the rendered result so `curl -s`
    // without `-L` shows the answer too.
    const target = permalink(tool.name, args);
    const redirectBody = `<p>Done. <a href="${escapeHtml(target)}">Continue to the permalink</a> (${escapeHtml(target)}).</p>${bodyHtml}`;
    return { ...shellPage(303, redirectBody), location: new URL(target, url).toString() };
  }

  return shellPage(200, bodyHtml);
}
