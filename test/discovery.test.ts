import { describe, expect, it } from "vitest";
import { robotsTxt, llmsTxt, webmcpBridge } from "../src/discovery.js";
import { req } from "./helpers.js";

describe("discovery", () => {
  describe("robotsTxt()", () => {
    it("contains the required directives", () => {
      const txt = robotsTxt();
      expect(txt).toContain("User-agent: *");
      expect(txt).toContain("Allow: /");
      expect(txt).toContain("Allow: /try");
      expect(txt).toContain("Disallow: /mcp");
      expect(txt).not.toContain("Sitemap:");
    });

    it("is text/plain over HTTP", async () => {
      const r = await req("/robots.txt");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/plain");
    });
  });

  describe("llmsTxt(tools)", () => {
    it("contains the header, install instruction, and tools section", () => {
      const tools = [
        { name: "ask_alex", description: "Ask a question about Alex Chernysh." },
        { name: "get_profile", description: "Structured professional profile." },
      ];
      const txt = llmsTxt(tools);
      expect(txt).toContain("# alexchernysh mcp");
      expect(txt).toContain("claude mcp add --transport http alex https://mcp.alexchernysh.com/mcp");
      expect(txt).toContain("## Tools");
    });

    it("lists each tool with backticks around the name", () => {
      const tools = [
        { name: "ask_alex", description: "Ask a question." },
        { name: "get_profile", description: "Get profile." },
      ];
      const txt = llmsTxt(tools);
      expect(txt).toContain("`ask_alex`: Ask a question.");
      expect(txt).toContain("`get_profile`: Get profile.");
    });

    it("produces valid format over HTTP", async () => {
      const r = await req("/llms.txt");
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("text/markdown");
      const txt = await r.text();
      expect(txt).toContain("# alexchernysh mcp");
      expect(txt).toContain("claude mcp add --transport http alex");
      expect(txt).toContain("## Tools");
    });
  });

  describe("webmcpBridge()", () => {
    it("returns null", () => {
      const bridge = webmcpBridge();
      expect(bridge).toBeNull();
    });

    it("causes /.webmcp/bridge.js to return 404", async () => {
      const r = await req("/.webmcp/bridge.js");
      expect(r.status).toBe(404);
      expect(r.headers.get("content-type")).toContain("application/json");
    });
  });
});
