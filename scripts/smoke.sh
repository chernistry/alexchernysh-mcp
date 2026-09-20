#!/usr/bin/env bash
# Post-deploy probes against the live hostname. Any miss exits non-zero.
# Override the target with BASE when probing somewhere else.
set -uo pipefail

BASE="${BASE:-https://mcp.alexchernysh.com}"
UA="alexchernysh-mcp-smoke"
fails=0

check() { # check <name> <expected> <actual>
  if [ "$2" = "$3" ]; then
    echo "ok    $1"
  else
    echo "FAIL  $1: expected '$2', got '$3'"
    fails=$((fails + 1))
  fi
}

contains() { # contains <name> <needle> <haystack>
  case "$3" in
    *"$2"*) echo "ok    $1" ;;
    *) echo "FAIL  $1: '$2' not in '$3'"; fails=$((fails + 1)) ;;
  esac
}

code() { curl -sS -o /dev/null -w '%{http_code}' -A "$UA" -m 20 "$@"; }
header() { curl -sSI -A "$UA" -m 20 "$1" | tr -d '\r' | awk -v h="$2" 'BEGIN{IGNORECASE=1} tolower($1)==tolower(h)":" {sub(/^[^:]*: */,""); print}'; }

echo "probing ${BASE}"

check "GET /healthz" 200 "$(code "${BASE}/healthz")"
contains "GET /healthz body" '"ok":true' "$(curl -sS -A "$UA" -m 20 "${BASE}/healthz")"

check "GET /" 200 "$(code "${BASE}/")"
contains "GET / content-type" "text/html" "$(header "${BASE}/" content-type)"

check "GET /try" 200 "$(code "${BASE}/try")"
check "GET /robots.txt" 200 "$(code "${BASE}/robots.txt")"
check "GET /nope" 404 "$(code "${BASE}/nope")"

check "GET /mcp (html)" 303 "$(code -H 'accept: text/html' "${BASE}/mcp")"
check "GET /mcp (json)" 405 "$(code "${BASE}/mcp")"

check "GET /fonts/manrope-400.woff2" 200 "$(code "${BASE}/fonts/manrope-400.woff2")"
contains "font cache-control" "immutable" "$(header "${BASE}/fonts/manrope-400.woff2" cache-control)"

contains "security headers" "nosniff" "$(header "${BASE}/healthz" x-content-type-options)"

tools=$(curl -sS -A "$UA" -m 30 -X POST "${BASE}/mcp" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
for tool in ask_alex get_profile list_projects get_cv; do
  contains "tools/list has ${tool}" "\"${tool}\"" "${tools}"
done

if [ "$fails" -ne 0 ]; then
  echo "${fails} probe(s) failed"
  exit 1
fi
echo "all probes passed"
