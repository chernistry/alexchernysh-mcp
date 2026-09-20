// GET/POST /try — the tool console.
//
// Stub: the router and its tests are complete without it. The real page
// lands with the shell.

import type { Env } from "../index.js";

export async function renderTry(
  _env: Env,
  _url: URL,
  _form?: FormData,
): Promise<{ html: string; csp: string; status: number }> {
  return { html: "<!doctype html><title>stub</title>", csp: "default-src 'none'", status: 200 };
}
