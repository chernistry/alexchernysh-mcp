#!/usr/bin/env bash
# The Worker may talk to exactly one host. Any other fetch target in src/ fails the build.
set -euo pipefail
bad=$(grep -rnoE 'https?://[a-zA-Z0-9._-]+' src/ | grep -vE 'alexchernysh\.com|mcp\.alexchernysh\.com|w3\.org|modelcontextprotocol\.io|github\.com/chernistry|mcp\.bernstein\.run' || true)
if [ -n "$bad" ]; then echo "unexpected outbound host(s):"; echo "$bad"; exit 1; fi
echo "outbound hosts ok"
