#!/usr/bin/env bash
# The Worker may talk to exactly one host. Any other URL in src/ fails the build:
# fetch targets and page links alike, so a stray CDN or font host cannot slip in.
# The match keeps the first path segment so a link to this project's own
# repository can be allowed without allowing the whole of github.com.
set -euo pipefail
bad=$(grep -rnoE 'https?://[a-zA-Z0-9._-]+(/[a-zA-Z0-9._-]+)?' src/ | grep -vE 'alexchernysh\.com|mcp\.alexchernysh\.com|w3\.org|modelcontextprotocol\.io|github\.com/chernistry' || true)
if [ -n "$bad" ]; then echo "unexpected outbound host(s):"; echo "$bad"; exit 1; fi
echo "outbound hosts ok"
