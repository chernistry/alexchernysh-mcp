// The HTML shell every page is rendered into.
//
// Three jobs, in one place so the two pages cannot drift apart:
//
//   1. The design tokens and base rules (STYLE). Colours, type and spacing are
//      the same ones alexchernysh.com uses, written out as custom properties
//      with a `prefers-color-scheme` block. There is no theme toggle: the page
//      follows the system.
//   2. The document head. Everything it references is served by this Worker —
//      three bundled woff2 faces from /fonts/*, a favicon inlined as a data
//      URI — so a page loads no third-party resource.
//   3. The Content-Security-Policy that matches what the page actually
//      contains. `cspHeaderFor()` hashes the one inline script, so the policy
//      can stay at `script-src 'sha256-…'` with no nonce, no 'unsafe-inline'
//      and no way to add a second script without the header disagreeing.
//
// `page()` is synchronous because the router renders inside a single `fetch`
// turn, so the SHA-256 below is a small synchronous implementation rather than
// the async WebCrypto one. test/csp.test.ts recomputes every hash with
// crypto.subtle and asserts it matches the header.

const SITE = "https://mcp.alexchernysh.com";

/* ------------------------------------------------------------------ *
 * SHA-256 (synchronous) + base64, for the script hash in the CSP.
 * ------------------------------------------------------------------ */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number): number => ((x >>> n) | (x << (32 - n))) >>> 0;

function sha256(bytes: Uint8Array): Uint8Array {
  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const len = bytes.length;
  const padded = new Uint8Array((((len + 9 + 63) / 64) | 0) * 64);
  padded.set(bytes);
  padded[len] = 0x80;
  const view = new DataView(padded.buffer);
  const bits = len * 8;
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000));
  view.setUint32(padded.length - 4, bits >>> 0);

  const W = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a15 = W[i - 15], a2 = W[i - 2];
      const s0 = (rotr(a15, 7) ^ rotr(a15, 18) ^ (a15 >>> 3)) >>> 0;
      const s1 = (rotr(a2, 17) ^ rotr(a2, 19) ^ (a2 >>> 10)) >>> 0;
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) >>> 0;
      const ch = ((e & f) ^ (~e & g)) >>> 0;
      const t1 = (h + S1 + ch + K[i] + W[i]) >>> 0;
      const S0 = (rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) >>> 0;
      const maj = ((a & b) ^ (a & c) ^ (b & c)) >>> 0;
      const t2 = (S0 + maj) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0;
      d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  const ov = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) ov.setUint32(i * 4, H[i]);
  return out;
}

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function base64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b: number | undefined = i + 1 < bytes.length ? bytes[i + 1] : undefined;
    const c: number | undefined = i + 2 < bytes.length ? bytes[i + 2] : undefined;
    out += B64[a >>> 2] + B64[((a & 3) << 4) | ((b ?? 0) >>> 4)];
    out += b === undefined ? "==" : B64[((b & 15) << 2) | ((c ?? 0) >>> 6)] + (c === undefined ? "=" : B64[c & 63]);
  }
  return out;
}

/**
 * The policy for a page carrying exactly this inline script. Nothing may be
 * fetched that this Worker does not serve; with no script the directive is
 * `'none'` rather than a hash, so an empty page is not a looser page.
 */
export function cspHeaderFor(script: string): string {
  const src = script ? `'sha256-${base64(sha256(new TextEncoder().encode(script)))}'` : "'none'";
  return [
    "default-src 'none'",
    "style-src 'unsafe-inline'",
    `script-src ${src}`,
    "font-src 'self'",
    "connect-src 'self'",
    "img-src data:",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/* ------------------------------------------------------------------ *
 * Tokens and base rules.
 * ------------------------------------------------------------------ */

const FONTS = [
  ["Cormorant Garamond", "cormorant-garamond-600", 600],
  ["Manrope", "manrope-400", 400],
  ["Manrope", "manrope-600", 600],
] as const;

const FONT_FACES = FONTS.map(
  ([family, file, weight]) =>
    `@font-face{font-family:"${family}";src:url(/fonts/${file}.woff2) format("woff2");font-weight:${weight};font-style:normal;font-display:swap}`,
).join("");

export const STYLE = `${FONT_FACES}
:root{
--bg:hsl(0 0% 100%);--bg-2:hsl(240 4.8% 95.9%);
--ink:hsl(240 10% 3.9%);--ink-soft:hsl(240 3.8% 46.1%);--ink-faint:hsl(240 5% 64.9%);
--rule:hsl(240 5.9% 90%);--rule-strong:hsl(240 5% 75%);
--pill:oklch(23% 0.01 255);--pill-fg:oklch(98.2% 0.004 255);
--ok:hsl(145 40% 35%);--warn:hsl(38 70% 42%);--bad:hsl(0 65% 45%);
--radius:12px;
--font-display:"Cormorant Garamond",Georgia,"Times New Roman",serif;
--font-ui:Manrope,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
--font-mono:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;
--step:8px}
@media (prefers-color-scheme:dark){:root{
--bg:hsl(240 10% 3.9%);--bg-2:hsl(240 3.7% 15.9%);
--ink:hsl(0 0% 98%);--ink-soft:hsl(240 5% 64.9%);--ink-faint:hsl(240 5% 45%);
--rule:hsl(240 3.7% 15.9%);--rule-strong:hsl(240 4% 28%);
--pill:oklch(98.2% 0.004 255);--pill-fg:oklch(23% 0.01 255);
--ok:hsl(145 40% 45%);--warn:hsl(38 70% 52%);--bad:hsl(0 65% 55%)}}
*,*::before,*::after{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--font-ui);font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:1080px;margin:0 auto;padding-left:clamp(20px,5vw,40px);padding-right:clamp(20px,5vw,40px)}
a{color:inherit}
:focus-visible{outline:2px solid var(--ink);outline-offset:3px;border-radius:4px}
h1{font-family:var(--font-display);font-weight:600;font-size:clamp(40px,6.5vw,64px);letter-spacing:-.04em;line-height:.95;margin:0}
h2{font-family:var(--font-display);font-weight:600;font-size:clamp(24px,2.6vw,30px);letter-spacing:-.02em;line-height:1.1;margin:0 0 16px}
h2.later{margin-top:calc(var(--step)*5)}
.lede{margin:20px 0 0;max-width:62ch;font-size:clamp(17px,1.6vw,20px);line-height:1.5;color:var(--ink-soft)}
.label{font-family:var(--font-mono);font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-faint)}
.meta{font-family:var(--font-mono);font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-faint)}
.nav{border-bottom:1px solid var(--rule)}
.nav-in{display:flex;align-items:center;justify-content:space-between;gap:20px;min-height:56px;flex-wrap:wrap;padding-top:8px;padding-bottom:8px}
.brand{font-family:var(--font-mono);font-size:13px;letter-spacing:.02em;text-decoration:none;white-space:nowrap}
.brand em{font-style:normal;color:var(--ink-faint)}
.nav-links{display:flex;gap:18px;flex-wrap:wrap;font-family:var(--font-mono);font-size:12px;letter-spacing:.04em}
.nav-links a{color:var(--ink-soft);text-decoration:none;border-bottom:1px solid transparent;padding-bottom:2px}
.nav-links a:hover{color:var(--ink);border-bottom-color:var(--rule-strong)}
.hero{padding-top:calc(var(--step)*7)}
.stamp-row{display:flex;flex-wrap:wrap;align-items:center;gap:10px 16px;margin-bottom:calc(var(--step)*3.5)}
.stamp{display:inline-flex;align-items:center;gap:8px;font-family:var(--font-mono);font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-soft);border:1px solid var(--rule);border-radius:999px;padding:5px 12px}
.dot{width:6px;height:6px;border-radius:50%;background:var(--ok);flex:none}
.stamp .dot{animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.3;transform:scale(.7)}}
.grid{display:grid;grid-template-columns:1.05fr .95fr;gap:calc(var(--step)*5);align-items:start;padding-top:calc(var(--step)*7)}
@media (max-width:880px){.grid{grid-template-columns:1fr;gap:calc(var(--step)*6)}}
.col{min-width:0}
.install{border:1px solid var(--rule);border-radius:var(--radius);overflow:hidden;background:var(--bg)}
.tabs{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 12px;background:var(--bg-2);border-bottom:1px solid var(--rule)}
.tablist{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.chip{appearance:none;background:transparent;color:var(--ink-soft);border:1px solid var(--rule);border-radius:999px;padding:5px 11px;font-family:var(--font-mono);font-size:11px;letter-spacing:.06em;cursor:pointer}
.chip:hover{color:var(--ink);border-color:var(--rule-strong)}
.chip[aria-selected="true"]{background:var(--bg);color:var(--ink);border-color:var(--rule-strong)}
.btn{appearance:none;border:1px solid transparent;background:var(--pill);color:var(--pill-fg);border-radius:999px;font-family:var(--font-mono);font-size:13px;padding:6px 15px;line-height:1.2;cursor:pointer}
.btn:hover{opacity:.88}
.copy{margin-left:auto}
.install .pane{padding:16px 16px 18px;overflow-x:auto}
.install .pane[hidden]{display:none}
pre{margin:0;font-family:var(--font-mono);font-size:12.5px;line-height:1.7;white-space:pre;tab-size:2}
.install pre{white-space:pre-wrap;overflow-wrap:break-word}
.tools{width:100%;border-collapse:collapse;margin-top:calc(var(--step)*2);font-size:14px}
.tools td{padding:12px 0;border-top:1px solid var(--rule);vertical-align:top}
.tools tr:first-child td{border-top:0}
.tools td:first-child{font-family:var(--font-mono);font-size:12.5px;white-space:nowrap;padding-right:20px;width:1%}
.tools td:last-child{color:var(--ink-soft);line-height:1.5}
.limits{margin-top:calc(var(--step)*2.5)}
.exchange{border:1px solid var(--rule);border-radius:var(--radius);overflow:hidden;background:var(--bg)}
.exchange-head{display:flex;align-items:center;gap:9px;padding:11px 14px;background:var(--bg-2);border-bottom:1px solid var(--rule);font-family:var(--font-mono);font-size:12px;color:var(--ink-soft)}
.exchange-head .name{color:var(--ink)}
.exchange[data-source="live"] .exchange-head .dot{background:var(--ok);animation:pulse 2.4s ease-in-out infinite}
.exchange[data-source="cache"] .exchange-head .dot{background:var(--warn)}
.exchange[data-source="snapshot"] .exchange-head .dot{background:transparent;box-shadow:inset 0 0 0 1px var(--rule-strong)}
.exchange .pane{padding:14px 16px 16px;overflow:auto}
.exchange .pane .label{display:block;margin-bottom:8px}
.exchange .out{max-height:360px}
.exchange .out pre{white-space:pre-wrap;overflow-wrap:anywhere}
.seam{position:relative;height:1px;background:var(--rule)}
.seam .node{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);width:22px;height:22px;border-radius:999px;border:1px solid var(--rule);background:var(--bg);display:grid;place-items:center;font-family:var(--font-mono);font-size:11px;line-height:1;color:var(--ink-faint)}
.seam::after{content:"";position:absolute;top:-1px;left:0;width:64px;height:3px;border-radius:2px;background:linear-gradient(90deg,transparent,var(--rule-strong),transparent);opacity:0;animation:wire 1.5s cubic-bezier(.4,0,.2,1) .4s 1}
@keyframes wire{0%{left:0;opacity:0}20%{opacity:1}80%{opacity:1}100%{left:calc(100% - 64px);opacity:0}}
.more{display:block;padding:11px 16px;border-top:1px solid var(--rule);background:var(--bg-2);font-family:var(--font-mono);font-size:11.5px;color:var(--ink-soft);text-decoration:none}
.more:hover{color:var(--ink)}
.note{margin:calc(var(--step)*7) 0 0;padding-top:calc(var(--step)*3);border-top:1px solid var(--rule);color:var(--ink-soft)}
.note p{margin:0;max-width:72ch}
footer{margin-top:calc(var(--step)*8);border-top:1px solid var(--rule)}
.foot{display:flex;gap:18px;flex-wrap:wrap;padding-top:22px;padding-bottom:44px;font-family:var(--font-mono);font-size:12px;color:var(--ink-faint)}
.foot a{color:var(--ink-soft);text-decoration:none;border-bottom:1px solid transparent}
.foot a:hover{color:var(--ink);border-bottom-color:var(--rule-strong)}
.nav-links a[aria-current="page"]{color:var(--ink);border-bottom-color:var(--rule-strong)}
.try{padding-top:calc(var(--step)*7)}
.try form{margin-top:calc(var(--step)*4);display:grid;gap:14px;max-width:560px}
.field{display:grid;gap:6px}
.field label{font-family:var(--font-mono);font-size:11px;letter-spacing:.10em;text-transform:uppercase;color:var(--ink-soft)}
.field input,.field select,.field textarea{font:inherit;font-size:15px;padding:8px 10px;border:1px solid var(--rule-strong);border-radius:8px;background:var(--bg);color:var(--ink);max-width:100%}
.field textarea{min-height:96px;font-family:var(--font-mono);font-size:13px;resize:vertical}
.field input[type="checkbox"]{width:auto;margin-right:6px}
.actions{display:flex;gap:10px;flex-wrap:wrap;padding-top:4px}
.btn.ghost{background:transparent;color:var(--ink);border-color:var(--rule-strong)}
.curl{margin:calc(var(--step)*3) 0 0;padding:12px 14px;border:1px solid var(--rule);border-radius:var(--radius);background:var(--bg-2);font-family:var(--font-mono);font-size:12.5px;line-height:1.5;color:var(--ink-soft);overflow-wrap:anywhere}
.curl code{font:inherit}
.result{margin-top:calc(var(--step)*4);border:1px solid var(--rule);border-radius:var(--radius);overflow:hidden;background:var(--bg)}
.verdict{padding:11px 14px;background:var(--bg-2);border-bottom:1px solid var(--rule);font-family:var(--font-mono);font-size:12px}
.verdict.ok{color:var(--ok)}
.verdict.error{color:var(--bad)}
.result pre{margin:0;padding:14px 16px;font-family:var(--font-mono);font-size:12.5px;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;max-height:420px;overflow:auto}
.result pre.request{border-bottom:1px solid var(--rule);color:var(--ink-soft)}
@media (prefers-reduced-motion:reduce){*,*::before,*::after{animation:none!important;transition:none!important}}`;

// Without scripting the tabs cannot switch, so every pane is shown at once and
// the controls that would do nothing are removed.
const NOSCRIPT_STYLE = `.install .pane[hidden]{display:block;border-top:1px solid var(--rule)}.tabs{display:none}`;

// 32x32 circle in --ink, inlined so the tab icon costs no request. The media
// query inside the SVG keeps it visible on a dark browser chrome.
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2032%2032'%3E" +
  "%3Cstyle%3Ecircle%7Bfill:%2309090b%7D@media(prefers-color-scheme:dark)%7Bcircle%7Bfill:%23fafafa%7D%7D%3C/style%3E" +
  "%3Ccircle%20cx='16'%20cy='16'%20r='13'/%3E%3C/svg%3E";

/**
 * Wraps a rendered body in the document shell and returns it with the policy
 * that matches it. `script` is the page's one inline script; its hash is what
 * `script-src` allows, so adding a second script breaks the page loudly rather
 * than quietly widening the policy.
 */
export function page(opts: {
  title: string;
  description: string;
  path: "/" | "/try";
  body: string;
  script?: string;
}): { html: string; csp: string } {
  const script = opts.script ?? "";
  const canonical = opts.path === "/" ? `${SITE}/` : `${SITE}${opts.path}`;
  const html =
    "<!doctype html>" +
    '<html lang="en">' +
    "<head>" +
    '<meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="color-scheme" content="light dark">' +
    `<title>${escapeHtml(opts.title)}</title>` +
    `<meta name="description" content="${escapeHtml(opts.description)}">` +
    `<link rel="canonical" href="${canonical}">` +
    `<link rel="icon" href="${FAVICON}">` +
    '<link rel="alternate" type="text/markdown" href="/llms.txt">' +
    '<meta property="og:type" content="website">' +
    `<meta property="og:title" content="${escapeHtml(opts.title)}">` +
    `<meta property="og:description" content="${escapeHtml(opts.description)}">` +
    `<meta property="og:url" content="${canonical}">` +
    `<style>${STYLE}</style>` +
    `<noscript><style>${NOSCRIPT_STYLE}</style></noscript>` +
    "</head>" +
    "<body>" +
    opts.body +
    (script ? `<script>${script}</script>` : "") +
    "</body></html>";
  return { html, csp: cspHeaderFor(script) };
}

/** Site header shared by every page; `active` underlines the current section. */
export function navBar(active: "/" | "/try" = "/"): string {
  const link = (href: string, label: string) =>
    `<a href="${href}"${href === active ? ' aria-current="page"' : ""}>${label}</a>`;
  return (
    '<header class="nav"><div class="wrap nav-in">' +
    '<a class="brand" href="/">alexchernysh <em>mcp</em></a>' +
    '<nav class="nav-links" aria-label="Sections">' +
    link("/#install", "install") +
    link("/try", "try") +
    '<a href="https://alexchernysh.com">alexchernysh.com</a>' +
    '<a href="https://github.com/chernistry/alexchernysh-mcp">source</a>' +
    "</nav></div></header>"
  );
}

/** Site footer shared by every page. */
export function footer(): string {
  return (
    '<footer><div class="wrap foot">' +
    '<a href="https://alexchernysh.com">alexchernysh.com</a>' +
    '<a href="https://github.com/chernistry/alexchernysh-mcp">source</a>' +
    '<a href="https://mcp.bernstein.run">mcp.bernstein.run</a>' +
    "</div></footer>"
  );
}

/** Escapes a string for interpolation into HTML text or a quoted attribute. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
