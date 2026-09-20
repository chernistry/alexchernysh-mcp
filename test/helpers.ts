import worker, { type Env } from "../src/index.js";
export const env: Env = { MCP_EDGE_SECRET: "test-secret", ORIGIN_MCP_URL: "https://alexchernysh.com/mcp" };
export const ctx = { waitUntil: () => undefined, passThroughOnException: () => undefined } as unknown as ExecutionContext;
export const req = (path: string, init?: RequestInit) => worker.fetch(new Request(`https://mcp.alexchernysh.com${path}`, init), env, ctx);
/** Replace global fetch for one test; returns a restore fn and the calls it saw. */
export function mockOrigin(handler: (req: Request) => Response | Promise<Response>) {
  const calls: Request[] = []; const real = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => { const r = new Request(input, init); calls.push(r); return handler(r); }) as typeof fetch;
  return { calls, restore: () => { globalThis.fetch = real; } };
}
export const rpcOk = (id: number, result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id, result }), { headers: { "content-type": "application/json" } });
