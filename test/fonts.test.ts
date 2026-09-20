import { describe, expect, it } from "vitest";
import { req } from "./helpers.js";

const FILES = ["cormorant-garamond-600.woff2", "manrope-400.woff2", "manrope-600.woff2"];

describe("GET /fonts/*", () => {
  for (const name of FILES) {
    it(`${name} is an immutable woff2 under 60 KB`, async () => {
      const r = await req(`/fonts/${name}`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toBe("font/woff2");
      expect(r.headers.get("cache-control")).toContain("immutable");
      expect(r.headers.get("x-content-type-options")).toBe("nosniff");
      const bytes = await r.arrayBuffer();
      expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("wOF2");
      expect(bytes.byteLength).toBeGreaterThan(1024);
      expect(bytes.byteLength).toBeLessThan(60 * 1024);
    });
  }

  it("an unknown font is a 404 json, not an empty body", async () => {
    const r = await req("/fonts/nope.woff2");
    expect(r.status).toBe(404);
    expect(r.headers.get("content-type")).toContain("application/json");
  });

  it("a path that escapes the font map is a 404", async () => {
    const r = await req("/fonts/../package.json");
    expect(r.status).toBe(404);
  });
});
