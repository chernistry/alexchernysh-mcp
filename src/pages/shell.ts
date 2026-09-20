// The HTML shell every page is rendered into: tokens, layout, the CSP that
// matches what the page actually contains.
//
// Stub: the router and its tests are complete without it. The real shell
// lands with the pages.

const STUB = { html: "<!doctype html><title>stub</title>", csp: "default-src 'none'" };

export function page(_opts: {
  title: string;
  description: string;
  path: "/" | "/try";
  body: string;
  script?: string;
}): { html: string; csp: string } {
  return { ...STUB };
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
