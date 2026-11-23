#!/bin/sh
# Entry point inside sfdaily-test-runner. Preflight proves isolation and the stubs, then node --test.
set -u
cd /app/repo
node tests/lib/preflight.js || exit 3
if [ "$#" -eq 0 ]; then set -- 'tests/**/*.test.js'; fi
exec node --test --test-concurrency=1 --test-force-exit --test-reporter=spec "$@"
