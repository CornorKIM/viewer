# tests/lib — gate harness and test-binding convention

This folder holds the helpers shared by the gates under `tests/sf-daily/` and `tests/interfaces/`,
and the **test-binding convention**: the few names and hooks the sf-daily implementation must offer
so the gates can import and drive it. The convention is *not* a contract change — the contracts in
`docs/spec/` stay the only source of what sf-daily must guarantee. It only says where the gates
plug in. Anything the convention does not fix is the implementer's choice.

## Running

```bash
tests/run.sh                                        # every gate
tests/run.sh 'tests/sf-daily/step-sender/**/*.test.js'   # a subset (node --test patterns)
```

Everything runs in throwaway Docker containers (project `sfdaily-test`); nothing is installed on the
host and the runner removes its containers, network and volumes on exit.

1. `sfdaily-test-deps` (node:22-alpine, the only container with network egress) runs
   `npm ci --omit=dev` from the repo's `package.json` / `package-lock.json` into a throwaway volume.
   Dependencies the implementation needs go into the root `package.json` as usual.
2. `sfdaily-test-db` (postgres:16-alpine, data on tmpfs, no host port) holds
   - database `postgres`: a copy of `tp23.sf_log_history` and `tp1.sf_log_history` with the exact
     DDL of `api/_sf-history.js` and `api/_tp1.js` (`db-init/01-history.sql`);
   - database `sfdaily`: the dedicated DB, created **empty**.
3. `sfdaily-test-runner` (node:22-alpine, `TZ=UTC`) sits on an **internal network with no route out**,
   runs `preflight.js` (isolation and stub self-checks; exit 3 stops everything if any fails), then
   `node --test --test-concurrency=1 --test-force-exit 'tests/**/*.test.js'`.

Exit code: the `node --test` code (0 = all green) · 2 harness could not start · 3 preflight failed.

## Safety (docs/ops/hazards.md)

- The real log API, Google calendar, Gmail SMTP and the Windows PostgreSQL `175.193.55.102` are
  unreachable from the runner (internal network; preflight proves it).
- The contract host names `log.smart-factory.kr` and `calendar.google.com` are pinned to `127.0.0.1`
  (`extra_hosts`), where `fake-internet.js` answers HTTPS with a throwaway CA (`tls/`). The runner
  trusts that CA through `NODE_EXTRA_CA_CERTS`. So the implementation keeps the contract URLs.
- All keys and passwords in `env.js` are fake. `.env` is never read.

## Test-binding convention

### Modules and exports

The implementation lives in `sf-daily/` at the repo root, one ES module per contract module.
The gates import only these exports (named as in the api contracts):

| File | Export the gates call |
|---|---|
| `sf-daily/business-day.js` | `judgeBusinessDay(at)` |
| `sf-daily/daily-plan.js` | `getDailyPlan(date)` |
| `sf-daily/step-sender.js` | `sendStep(request)` |
| `sf-daily/status-mail.js` | `sendStatusMail(date)` |
| `sf-daily/runner.js` | `createRunner(deps)` (below) |
| `sf-daily/main.js` | — the service entry: `node sf-daily/main.js` starts the service |

`sf-daily/companies.js` (or any other file) is free; the gates never import it.
Importing a module must not start timers or the service. ES modules: the files must load as ESM
under Node 22 (e.g. `"type": "module"` in a `sf-daily/package.json`, or module-syntax detection).

### Settings

Every setting is read from `process.env` with the names the contracts give
(`SF_LOG_KEY_*`, `SF_LOG_DEFAULT_IP`, `PG_HOST`, `PG_PASSWORD`, `SF_DB_URL`, `SMTP_*`, `SF_REPORT_TO`,
`SF_REPORT_LINK`, `SF_HOLIDAY_CALENDAR_URL`, `SF_DAILY_*`, `SF_REPORT_AT`). In-process gates set the
environment once, before their first import; gates that need other values start a separate node
process. So reading at import time or at call time both work.

- **History DB** — `PG_HOST` · `PG_PASSWORD` with port 5432, database `postgres`, user `postgres`,
  the same coordinates as the existing `api/_sf-send.js` `PG_CONFIG`. In the harness `PG_HOST` is the
  throwaway container.
- **Dedicated DB** — `SF_DB_URL`. It is handed over empty: sf-daily creates whatever tables it needs
  on first use (concurrently safe — gates call from several processes at once). Between tests the
  gates empty **every** table of that DB (`TRUNCATE`), whatever its name, and never drop it.
- **Log API** — the contract URL `https://log.smart-factory.kr/apisvc/sendLogData.json` (no setting).
- **Calendar** — `SF_HOLIDAY_CALENDAR_URL`, empty → the contract URL.
- **Mail server** — `SMTP_HOST` (`smtp.test` in the harness) · `SMTP_PORT` (default 587).
  Use Node's standard TLS verification (no pinning, no disabled verification): the stub's
  certificate is trusted only through `NODE_EXTRA_CA_CERTS`.

### Clock

All of sf-daily reads "now" through one clock:

- `SF_DAILY_FAKE_NOW` unset → the real clock.
- `SF_DAILY_FAKE_NOW=<ISO instant>` → now = that instant + the real time elapsed since the clock
  first saw this value (it advances at real speed). Used by the disabled-service gates and by
  `DP-09` — runner §6 forbids it when `SF_DAILY_ENABLED=true`.
- The real clock is read through the JS `Date` (`Date.now()` / `new Date()`), not through another
  time source. Gates that need an *enabled* service at a chosen instant preload
  `tests/lib/fake-clock.js` into `node sf-daily/main.js` (`startService(env, { fakeNow, fakeRate })`):
  it moves `Date` only — no sf-daily setting is involved — and can run it faster than real time;
  timers keep real speed. The DB's `now()` is not moved.

The step-sender and status-mail gates run on the real clock (history `sent_at` comes from the DB's
`now()`), so "today" there is the real KST date. Do not run those gates across KST midnight.

### `createRunner(deps)` — one round at a time

```js
const runner = createRunner({
  now,               // () => Date — the clock for this runner
  env,               // settings object (SF_DAILY_ENABLED, SF_REPORT_AT, …); default process.env
  judgeBusinessDay,  // the four seam functions, same signatures as the api contracts
  getDailyPlan,
  sendStep,
  sendStatusMail,
  log,               // (line: string) => void — one run-log line; default: standard output
});
await runner.tick(); // exactly one 회차 at deps.now()
```

- Each `tick()` is one round; the gates call it themselves at chosen fake instants
  (`tests/sf-daily/runner/world.js`). The round interval is not part of `createRunner`; `main.js`
  waits `SF_DAILY_TICK_SECONDS` between rounds.
- State lives in the instance; a new instance is "the service started again".
- `createRunner` does not validate settings — that is `main.js` at start.
- `main.js` wires the real modules into `createRunner` and loops.

## Helpers

| File | What |
|---|---|
| `run.sh` · `../docker-compose.test.yml` · `container-run.sh` | the harness (see Running) |
| `preflight.js` | isolation and stub self-checks before any gate |
| `sut.js` | loads `sf-daily/<module>.js`; a missing file / export fails the test as `SUT_MISSING` |
| `child.js` · `child-entry.js` · `wire.js` | call an export in a fresh node process (`signal` kills it mid-call) · start `main.js` (timed output lines, `kill(sig)`, `fakeNow`) |
| `fake-clock.js` | preload that moves `Date` in a spawned service (see Clock) |
| `env.js` · `roster.js` | fake settings and secrets · the roster tables of `companies.md` |
| `fake-internet.js` | HTTPS stand-in for the log API and the calendar; plain-HTTP calendar stub |
| `smtp-stub.js` · `mime.js` · `html.js` | ESMTP stub with STARTTLS · MIME decoding · reading the mail HTML |
| `ical.js` | iCalendar bodies shaped like the Google feed |
| `db.js` | history / dedicated DB access, seeding, schema snapshots · `failHistoryWrites` (a test trigger refuses history writes) · `lockHistoryTables` (history queries wait) |
| `sending.js` · `mail.js` | shared set-up for the step-sending and status-mail gates |
| `kst.js` | KST arithmetic independent of the process time zone |
| `tls/` | throwaway test CA and stub certificate (test-only, worthless outside the harness) |
