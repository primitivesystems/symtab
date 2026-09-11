#!/bin/sh
# Read-only smoke check against a running deployment; no vault mutations.
set -eu
base=${1:-http://127.0.0.1:3000}
check() {
  expected=$1
  route=$2
  shift 2
  actual=$(curl --silent --show-error --max-time 15 --output /dev/null --write-out '%{http_code}' "$@" "$base$route")
  [ "$actual" = "$expected" ] || { echo "FAIL $route: expected $expected, got $actual"; exit 1; }
}
check 200 /healthz
check 200 /
check 200 /api/v1/auth/status
check 401 /api/v1/status
check 200 /health
check 403 /api/v1/status -H 'Sec-Fetch-Site: cross-site'
echo 'PASS: login shell reachable; anonymous API denied; liveness and cross-site checks passed.'
