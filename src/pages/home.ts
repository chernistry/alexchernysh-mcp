// GET / — the landing page.
//
// The page is a demonstration of the endpoint rather than a description of it:
// the tools table is whatever `tools/list` answers right now, and the exchange
// on the right is one real `get_profile` call, rendered as the JSON-RPC request
// that went out and the response that came back, with the latency it took.
//
// Neither read may take the page down. `src/origin.ts` returns a `source` with
// every result — live, cache or snapshot — and that word is stamped onto the
// markup, so a page served while the origin is unreachable says so instead of
// pretending.

import { VERSION, type Env } from "../index.js";
import { listTools, callTool } from "../origin.js";
import { page, escapeHtml } from "./shell.js";

const ENDPOINT = "https://mcp.alexchernysh.com/mcp";

const TITLE = "mcp.alexchernysh.com — a read-only MCP endpoint";
const DESCRIPTION =
  "A stateless, read-only MCP endpoint that answers questions about Alex Chernysh. Four tools, any MCP client, nothing to sign up for.";
const LEDE =
  "A stateless, read-only MCP endpoint that answers questions about Alex Chernysh from the same notes and case studies the site is built on. Four tools. Any MCP client. Nothing to sign up for.";

const INSTALL: { label: string; command: string }[] = [
  { label: "claude code", command: `claude mcp add --transport http alex ${ENDPOINT}` },
  { label: "mcp.json", command: `{ "mcpServers": { "alex": { "type": "http", "url": "${ENDPOINT}" } } }` },
  {
    label: "curl",
    command:
      `curl -s ${ENDPOINT} -H 'content-type: application/json' -H 'accept: application/json' ` +
      `-d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'`,
  },
];

/** The demonstration call, and how many of its response lines the page shows. */
const DEMO_TOOL = "get_profile";
const MAX_RESPONSE_LINES = 60;

/** The one inline script: the install tabs and the copy button. Nothing else. */
const SCRIPT = `(function(){
var box=document.getElementById('install');if(!box)return;
var tabs=[].slice.call(box.querySelectorAll('[role="tab"]'));
var panes=[].slice.call(box.querySelectorAll('[role="tabpanel"]'));
if(!tabs.length||tabs.length!==panes.length)return;
function show(i){for(var j=0;j<tabs.length;j++){var sel=j===i;tabs[j].setAttribute('aria-selected',sel?'true':'false');tabs[j].tabIndex=sel?0:-1;panes[j].hidden=!sel;}}
for(var i=0;i<tabs.length;i++){(function(n){
tabs[n].addEventListener('click',function(){show(n);});
tabs[n].addEventListener('keydown',function(e){var d=e.key==='ArrowRight'?1:e.key==='ArrowLeft'?-1:0;if(!d)return;e.preventDefault();var t=(n+d+tabs.length)%tabs.length;show(t);tabs[t].focus();});
})(i);}
show(0);
var copy=box.querySelector('.copy');if(!copy)return;
var idle=copy.textContent;
function flash(m){copy.textContent=m;setTimeout(function(){copy.textContent=idle;},1400);}
copy.addEventListener('click',function(){
var pane=null;for(var k=0;k<panes.length;k++){if(!panes[k].hidden)pane=panes[k];}
if(!pane)return;var text=pane.querySelector('pre').textContent;
function legacy(){var ta=document.createElement('textarea');ta.value=text;ta.setAttribute('readonly','');ta.style.position='fixed';ta.style.top='-1000px';document.body.appendChild(ta);ta.select();try{document.execCommand('copy');flash('copied');}catch(err){flash('copy failed');}document.body.removeChild(ta);}
if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(function(){flash('copied');},legacy);}else{legacy();}
});
})();`;

const json = (value: unknown): string => {
  try {
    return JSON.stringify(value ?? null, null, 2) ?? "null";
  } catch {
    return "null";
  }
};

function navBar(): string {
  return (
    '<header class="nav"><div class="wrap nav-in">' +
    '<a class="brand" href="/">alexchernysh <em>mcp</em></a>' +
    '<nav class="nav-links" aria-label="Sections">' +
    '<a href="#install">install</a>' +
    '<a href="/try">try</a>' +
    '<a href="https://alexchernysh.com">alexchernysh.com</a>' +
    '<a href="https://github.com/chernistry/alexchernysh-mcp">source</a>' +
    "</nav></div></header>"
  );
}

function hero(): string {
  return (
    '<section class="wrap hero">' +
    '<div class="stamp-row">' +
    `<span class="stamp"><span class="dot"></span>v${escapeHtml(VERSION)} · read-only</span>` +
    '<span class="meta">no account · no key · nothing stored</span>' +
    "</div>" +
    "<h1>Point your agent at me.</h1>" +
    `<p class="lede">${escapeHtml(LEDE)}</p>` +
    "</section>"
  );
}

function installBox(): string {
  const tabs = INSTALL.map(
    (t, i) =>
      `<button class="chip" type="button" role="tab" id="tab-${i}" aria-controls="pane-${i}" ` +
      `aria-selected="${i === 0 ? "true" : "false"}" tabindex="${i === 0 ? "0" : "-1"}">${escapeHtml(t.label)}</button>`,
  ).join("");
  const panes = INSTALL.map(
    (t, i) =>
      `<div class="pane" role="tabpanel" id="pane-${i}" aria-labelledby="tab-${i}" tabindex="0"${i === 0 ? "" : " hidden"}>` +
      `<pre>${escapeHtml(t.command)}</pre></div>`,
  ).join("");
  return (
    '<div class="install" id="install">' +
    '<div class="tabs">' +
    `<div class="tablist" role="tablist" aria-label="Install command">${tabs}</div>` +
    '<button class="btn copy" type="button">copy</button>' +
    "</div>" +
    panes +
    "</div>"
  );
}

function toolsTable(tools: { name: string; description: string }[], source: string): string {
  const rows = tools
    .map((t) => `<tr><td>${escapeHtml(t.name)}</td><td>${escapeHtml(t.description ?? "")}</td></tr>`)
    .join("");
  return `<table class="tools" data-source="${escapeHtml(source)}"><tbody>${rows}</tbody></table>`;
}

/** The two-pane exchange: one real call, stamped with where the answer came from. */
function exchange(call: {
  source: string;
  ageSeconds: number;
  latencyMs: number | null;
  request: unknown;
  response: unknown;
}): string {
  const stamp =
    call.source === "live" && call.latencyMs !== null
      ? `${call.latencyMs} ms`
      : call.source === "cache"
        ? `cached ${Math.max(0, call.ageSeconds)}s ago`
        : call.source === "live"
          ? "live"
          : "snapshot";

  const lines = json(call.response).split("\n");
  const shown = lines.slice(0, MAX_RESPONSE_LINES);
  const hidden = lines.length - shown.length;
  const body = escapeHtml(shown.join("\n")) + (hidden > 0 ? "\n…" : "");
  const more =
    hidden > 0
      ? `<a class="more" href="/try/${DEMO_TOOL}">${hidden} more lines · run it yourself →</a>`
      : "";

  return (
    `<section class="exchange" data-source="${escapeHtml(call.source)}">` +
    '<header class="exchange-head">' +
    '<span class="dot"></span>' +
    `<span class="name">${DEMO_TOOL}</span> · <span>${escapeHtml(stamp)}</span>` +
    "</header>" +
    `<div class="pane"><span class="label">request</span><pre>${escapeHtml(json(call.request))}</pre></div>` +
    '<div class="seam"><span class="node" aria-hidden="true">↓</span></div>' +
    `<div class="pane out" tabindex="0"><span class="label">response</span><pre>${body}</pre></div>` +
    more +
    "</section>"
  );
}

function footer(): string {
  return (
    '<footer><div class="wrap foot">' +
    '<a href="https://alexchernysh.com">alexchernysh.com</a>' +
    '<a href="https://github.com/chernistry/alexchernysh-mcp">source</a>' +
    '<a href="https://mcp.bernstein.run">mcp.bernstein.run</a>' +
    "</div></footer>"
  );
}

export async function renderHome(env: Env): Promise<{ html: string; csp: string }> {
  const [tools, call] = await Promise.all([
    listTools(env),
    callTool(env, DEMO_TOOL, {}, { cache: true }),
  ]);

  const body =
    navBar() +
    "<main>" +
    hero() +
    '<div class="wrap grid">' +
    '<section class="col">' +
    "<h2>Install</h2>" +
    installBox() +
    '<h2 class="later">Tools</h2>' +
    toolsTable(tools.value, tools.source) +
    '<p class="meta limits">60 requests/min · 64 kb body · stateless</p>' +
    "</section>" +
    '<section class="col">' +
    "<h2>One real call</h2>" +
    exchange(call) +
    "</section>" +
    "</div>" +
    '<div class="wrap"><section class="note">' +
    "<p>Stateless here means every call carries everything it needs: there is no session to open, " +
    "no cookie to set and nothing kept once the response is written. " +
    "The exchange above is the whole interaction — reload the page and it starts from the same place.</p>" +
    "</section></div>" +
    "</main>" +
    footer();

  return page({ title: TITLE, description: DESCRIPTION, path: "/", body, script: SCRIPT });
}
