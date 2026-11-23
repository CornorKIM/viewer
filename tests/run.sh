#!/usr/bin/env bash
# sf-daily gate runner — everything runs in throwaway Docker containers (nothing installed on the host).
#
#   tests/run.sh                         # all gates
#   tests/run.sh 'tests/sf-daily/step-sender/**/*.test.js'   # a subset (node --test patterns)
#
# exit: the node --test exit code (0 = all green) · 2 = harness could not start · 3 = isolation preflight failed
set -uo pipefail
cd "$(dirname "$0")"
COMPOSE=(docker compose -p sfdaily-test -f docker-compose.test.yml)

cleanup() { "${COMPOSE[@]}" --profile deps down -v --remove-orphans --timeout 5 >/dev/null 2>&1 || true; }
trap cleanup EXIT INT TERM
cleanup

"${COMPOSE[@]}" --profile deps run --rm --no-deps sfdaily-test-deps || { echo "run.sh: dependency install failed" >&2; exit 2; }
"${COMPOSE[@]}" run --rm sfdaily-test-runner "$@"
