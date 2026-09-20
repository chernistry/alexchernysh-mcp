// GET / — the landing page.
//
// Stub: the router and its tests are complete without it. The real page
// lands with the shell.

import type { Env } from "../index.js";

export async function renderHome(_env: Env): Promise<{ html: string; csp: string }> {
  return { html: "<!doctype html><title>stub</title>", csp: "default-src 'none'" };
}
