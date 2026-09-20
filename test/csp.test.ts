// The policy on a page has to describe that exact page, or it is decoration.
// Every assertion below recomputes the hash from the rendered HTML with
// WebCrypto and compares it with the header the router actually sent, so the
// synchronous SHA-256 in src/pages/shell.ts cannot drift from the real one and
// a second inline script cannot be added without a test going red.

import { afterEach, describe, expect, it } from "vitest";
import { mockOrigin, req, rpcOk } from "./helpers.js";
import { cspHeaderFor } from "../src/pages/shell.js";

const tools = [
  { name: "ask_alex", description: "Ask a question about Alex Chernysh.", inputSchema: { type: "object", properties: {} } },
  { name: "get_profile", description: "Structured professional profile.", inputSchema: { type: "object", properties: {} } },
];

let m: ReturnType<typeof mockOrigin> | undefined;
afterEach(() => m?.restore());

const liveOrigin = () =>
  mockOrigin(async (r) => {
    const b = (await r.json()) as { method: string; id: number };
    return b.method === "tools/list" ? rpcOk(b.id, { tools }) : rpcOk(b.id, { content: [{ type: "text", text: "ok" }] });
  });

const SCRIPT_TAG = /<script\b[^>]*>([\s\S]*?)<\/script>/g;
/** An `on*=` attribute inside a tag — the only way an inline handler can appear. */
const INLINE_HANDLER = /<[a-z][a-z0-9-]*[^>]*\son[a-z]+\s*=/i;

async function sha256Base64(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let binary = "";
  for (const byte of new Uint8Array(digest)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

const policyFor = (hash: string): string =>
  `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${hash}'; font-src 'self'; ` +
  `connect-src 'self'; img-src data:; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`;

async function render(path: string): Promise<{ status: number; csp: string | null; html: string; scripts: string[] }> {
  const r = await req(path);
  const html = await r.text();
  return {
    status: r.status,
    csp: r.headers.get("content-security-policy"),
    html,
    // Only executable scripts count: a `type="application/json"` block is data the
    // browser never runs, so the CSP hash does not cover it.
    scripts: [...html.matchAll(SCRIPT_TAG)].filter((x) => !/\btype\s*=\s*["']application\/json["']/i.test(x[0])).map((x) => x[1] ?? ""),
  };
}

describe("content-security-policy", () => {
  it("pins the one inline script on /", async () => {
    m = liveOrigin();
    const { status, csp, html, scripts } = await render("/");
    expect(status).toBe(200);
    expect(scripts).toHaveLength(1);
    expect(csp).toBe(policyFor(await sha256Base64(scripts[0]!)));
    expect(html).not.toMatch(INLINE_HANDLER);
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
  });

  it("pins the one inline script on /try", async () => {
    m = liveOrigin();
    const { status, csp, html, scripts } = await render("/try");
    expect(status).toBe(200);
    expect(scripts).toHaveLength(1);
    expect(csp).toBe(policyFor(await sha256Base64(scripts[0]!)));
    expect(html).not.toMatch(INLINE_HANDLER);
    expect(html).not.toMatch(/<script[^>]+\bsrc=/i);
  });

  it("names 'none' rather than a hash when a page carries no script", () => {
    expect(cspHeaderFor("")).toContain("script-src 'none'");
  });

  it("agrees with WebCrypto across the SHA-256 block boundaries", async () => {
    const samples = ["", "a", "x".repeat(55), "y".repeat(56), "z".repeat(63), "q".repeat(64), "w".repeat(119), "e".repeat(120), "r".repeat(1000)];
    for (const s of samples) {
      if (!s) continue;
      expect(cspHeaderFor(s)).toBe(policyFor(await sha256Base64(s)));
    }
  });
});
