#!/usr/bin/env node
// Refreshes the bundled fallbacks the pages fall back to when the origin does
// not answer: the tool list and one get_profile result.
//
// Run: npm run snapshots
// Override the endpoint with ORIGIN_MCP_URL when pointing at a staging origin.

import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ORIGIN = process.env.ORIGIN_MCP_URL ?? "https://alexchernysh.com/mcp";
const DATA_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "data");
const TIMEOUT_MS = 20_000;

async function rpc(method, params, id) {
  const response = await fetch(ORIGIN, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      "user-agent": "alexchernysh-mcp-snapshots",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
  });
  if (!response.ok) throw new Error(`${method}: HTTP ${response.status}`);
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.code} ${body.error.message}`);
  return body.result;
}

async function write(name, value) {
  const path = join(DATA_DIR, name);
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  console.log(`wrote ${name}`);
}

const tools = await rpc("tools/list", {}, 1);
if (!Array.isArray(tools?.tools) || tools.tools.length === 0) throw new Error("tools/list returned no tools");
await write("tools.snapshot.json", tools.tools);

const profile = await rpc("tools/call", { name: "get_profile", arguments: {} }, 2);
await write("profile.snapshot.json", profile);
