// Gates for docs/spec/sf-daily/spec/runner.md that are judged on the service process itself
// (node sf-daily/main.js): start refusal, staying up, tick interval, stdout, stall, stop signal.
// An enabled service may not run with SF_DAILY_FAKE_NOW (runner §6), so enabled services get their
// wall clock moved by the fake-clock.js preload instead (startService(env, { fakeNow })). See GATES.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startService } from '../../lib/child.js';
import { serviceEnv, secrets, TEST_KEYS } from '../../lib/env.js';
import { startFakeInternet } from '../../lib/fake-internet.js';
import { startSmtpStub } from '../../lib/smtp-stub.js';
import { resetHistory, clearDedicated, closeDb, historyRows, lockHistoryTables } from '../../lib/db.js';
import { logReply } from '../../lib/fake-internet.js';
import { ROSTER } from '../../lib/roster.js';
import { kstAt, sleep } from '../../lib/kst.js';

const D = '2026-11-24'; // a Tuesday, a business day in the stub calendar
const QUIET = kstAt(D, '03:00:00'); // nothing is due at 03:00 KST
let fake;
let smtp;
const running = [];
before(async () => { fake = await startFakeInternet(); smtp = await startSmtpStub(); });
after(async () => { for (const s of running) await s.stop(); await fake.stop(); await smtp.close(); await closeDb(); });
beforeEach(async () => { await fake.start(); fake.reset(); smtp.reset(); await resetHistory(); await clearDedicated(); });

function start(env, opts) { const s = startService(env, opts); running.push(s); return s; }

/** The service must exit non-zero within 15 s and name every setting in `names`. */
async function refuses(overrides, names) {
    const s = start(serviceEnv(overrides), { fakeNow: QUIET });
    const exit = await s.waitExit(15_000);
    await s.stop();
    assert.ok(exit, `service did not stop with ${JSON.stringify(overrides)}`);
    assert.notEqual(exit.code, 0, 'exit code is not 0');
    for (const n of names) assert.ok(s.output.includes(n), `output names ${n}:\n${s.output}`);
}

/** The service must still be running after `ms`. */
async function staysUp(env, ms = 5000, opts) {
    const s = start(env, opts);
    const exit = await s.waitExit(ms);
    assert.equal(exit, null, `service exited ${JSON.stringify(exit)}:\n${s.output}`);
    return s;
}

test('RN-01 SF_DAILY_ENABLED 가 true · false 가 아니면 시작하지 않는다', { timeout: 60_000 }, async () => {
    for (const v of ['yes', 'TRUE', '1']) await refuses({ SF_DAILY_ENABLED: v }, ['SF_DAILY_ENABLED']);
});

test('RN-02 SF_DAILY_TICK_SECONDS 가 정수가 아니거나 10 미만 · 60 초과면 시작하지 않는다', { timeout: 90_000 }, async () => {
    for (const v of ['abc', '9', '61', '10.5', '-30']) await refuses({ SF_DAILY_TICK_SECONDS: v }, ['SF_DAILY_TICK_SECONDS']);
});

test('RN-03 SF_REPORT_AT 이 HH:MM 이 아니면 시작하지 않는다', { timeout: 60_000 }, async () => {
    for (const v of ['2300', 'ab:cd', '23:00:00', '23']) await refuses({ SF_REPORT_AT: v }, ['SF_REPORT_AT']);
});

test('RN-04 CO-11 켜져 있는데 업체 인증키가 비어 있으면 시작하지 않고 비어 있는 설정 이름을 모두 출력한다', { timeout: 60_000 }, async () => {
    await refuses({ SF_LOG_KEY_B: '' }, ['SF_LOG_KEY_B']);
    await refuses({ SF_LOG_KEY_A: null, SF_LOG_KEY_TP1_CDR: '' }, ['SF_LOG_KEY_A', 'SF_LOG_KEY_TP1_CDR']);
});

test('RN-05 SF_DB_URL 이 비어 있으면 시작하지 않는다', { timeout: 60_000 }, async () => {
    await refuses({ SF_DB_URL: '' }, ['SF_DB_URL']);
    await refuses({ SF_DB_URL: null, SF_DAILY_ENABLED: 'false' }, ['SF_DB_URL']);
});

test('RN-06 PG_PASSWORD 가 비어 있으면 시작하지 않는다', { timeout: 60_000 }, async () => {
    await refuses({ PG_PASSWORD: '' }, ['PG_PASSWORD']);
    await refuses({ PG_PASSWORD: null, SF_DAILY_ENABLED: 'false' }, ['PG_PASSWORD']);
});

test('RN-07 켜져 있는데 메일 필수 설정이 비었거나 받는 주소 모양이 틀리면 시작하지 않는다', { timeout: 120_000 }, async () => {
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SF_REPORT_TO']) await refuses({ [k]: '' }, [k]);
    await refuses({ SF_REPORT_TO: 'ops1@example.test,not-an-address' }, ['SF_REPORT_TO']);
});

test('RN-08 SF_LOG_DEFAULT_IP 가 IPv4 모양이 아니면 시작하지 않는다', { timeout: 60_000 }, async () => {
    for (const v of ['twin.smartline.kr', '1.2.3', 'abc']) await refuses({ SF_LOG_DEFAULT_IP: v }, ['SF_LOG_DEFAULT_IP']);
});

test('RN-09 걸린 설정이 여럿이면 그 이름을 모두 출력한다', { timeout: 60_000 }, async () => {
    await refuses({ SF_DAILY_TICK_SECONDS: '5', SF_REPORT_AT: 'noon', SF_LOG_KEY_C: '', SMTP_HOST: '', SF_LOG_DEFAULT_IP: 'x' },
        ['SF_DAILY_TICK_SECONDS', 'SF_REPORT_AT', 'SF_LOG_KEY_C', 'SMTP_HOST', 'SF_LOG_DEFAULT_IP']);
});

test('RN-10 시작 거부 조건에 걸리지 않으면 시작해 떠 있다 (꺼져 있으면 인증키 · 메일 설정 없이도)', { timeout: 60_000 }, async () => {
    const off = await staysUp({
        SF_DAILY_ENABLED: 'false', SF_DAILY_FAKE_NOW: QUIET.toISOString(), PG_PASSWORD: process.env.PG_PASSWORD, SF_DB_URL: process.env.SF_DB_URL,
        PG_HOST: process.env.PG_HOST,
    });
    await off.stop();
    const on = await staysUp(serviceEnv({ SF_DAILY_TICK_SECONDS: null, SF_REPORT_AT: null, SF_LOG_DEFAULT_IP: null }), 5000, { fakeNow: QUIET });
    await on.stop();
    const unset = await staysUp(serviceEnv({ SF_DAILY_FAKE_NOW: QUIET.toISOString(), SF_DAILY_ENABLED: null, ...Object.fromEntries(Object.keys(TEST_KEYS).map((k) => [k, null])) }));
    await unset.stop();
});

test('RN-11 SF_DAILY_ENABLED=false 이면 떠 있되 단계도 메일도 보내지 않는다', { timeout: 60_000 }, async () => {
    for (const hms of ['11:58:00', '23:10:00']) {
        const s = await staysUp(serviceEnv({ SF_DAILY_ENABLED: 'false', SF_DAILY_TICK_SECONDS: '10', SF_DAILY_FAKE_NOW: kstAt(D, hms).toISOString() }), 14_000);
        await s.stop();
    }
    assert.equal(fake.log.requests.length, 0, 'no log was sent');
    assert.equal(smtp.sessions.length, 0, 'no mail server connection');
});

function clusterStarts(times, gapMs = 3000) {
    const starts = [];
    for (const t of times) if (!starts.length || t - starts.at(-1).last > gapMs) starts.push({ first: t, last: t }); else starts.at(-1).last = t;
    return starts.map((c) => c.first);
}

// Log API always answers AP1029 at 11:58 KST of a business day: every due login is requested again
// in every round (error_response, then wait_10min), and every send result is a run-log line.
async function roundStarts(env, fakeNow, ms) {
    fake.log.respond = () => logReply('AP1029');
    const s = start(serviceEnv(env), { fakeNow });
    await sleep(ms);
    const exit = s.exit;
    const seen = [...s.lines]; // before the stop signal, whose own output is not a round
    await s.stop();
    assert.equal(exit, null, `service stayed up:\n${s.output}`);
    assert.ok(fake.log.requests.length >= 1, `precondition: a step was requested:\n${s.output}`);
    const firstSend = fake.log.requests[0].at; // start-up lines are not a round
    return clusterStarts(seen.filter((l) => l.at >= firstSend).map((l) => l.at));
}

test('RN-12 시각을 확인하는 간격은 SF_DAILY_TICK_SECONDS 초다', { timeout: 90_000 }, async () => {
    const starts = await roundStarts({ SF_DAILY_TICK_SECONDS: '10' }, kstAt(D, '11:58:00'), 34_000);
    assert.ok(starts.length >= 3, `rounds seen: ${starts.length}`);
    for (let i = 1; i < starts.length; i++) {
        const gap = (starts[i] - starts[i - 1]) / 1000;
        assert.ok(gap >= 8 && gap <= 14, `round gap ${gap}s`);
    }
});

test('RN-13 SF_DAILY_TICK_SECONDS 가 없으면 간격은 30 초다', { timeout: 120_000 }, async () => {
    const starts = await roundStarts({ SF_DAILY_TICK_SECONDS: null }, kstAt(D, '11:55:00'), 72_000);
    assert.ok(starts.length >= 2, `rounds seen: ${starts.length}`);
    for (let i = 1; i < starts.length; i++) {
        const gap = (starts[i] - starts[i - 1]) / 1000;
        assert.ok(gap >= 27 && gap <= 36, `round gap ${gap}s`);
    }
});

test('RN-14 CO-12 실행 기록(표준 출력)에 인증키 · 비밀번호가 나오지 않는다', { timeout: 90_000 }, async () => {
    const outputs = [];
    // steps due (A–D logins) at 11:58
    const a = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '11:58:00') });
    for (let i = 0; i < 30 && fake.log.requests.length === 0; i++) await sleep(500);
    await sleep(3000);
    await a.stop();
    outputs.push(a.output);
    assert.ok(fake.log.requests.length >= 1, `the service sent at least one step:\n${a.output}`);
    // mail due at 23:00
    const b = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '23:00:05') });
    for (let i = 0; i < 30 && smtp.messages.length === 0; i++) await sleep(500);
    await sleep(2000);
    await b.stop();
    outputs.push(b.output);
    assert.ok(smtp.messages.length >= 1, `the service sent the status mail:\n${b.output}`);
    const all = outputs.join('\n');
    assert.ok(all.trim().length > 0, 'the service wrote a run log');
    for (const sec of secrets()) assert.ok(!all.includes(sec), 'a secret is in the run log');
});

test('RN-38 확인 불가가 이어지는 동안 달력을 받는 간격은 10분 이상이다', { timeout: 120_000 }, async () => {
    // The service's clock runs 30× real speed: a 10 s round is 5 minutes of service time.
    const RATE = 30;
    fake.calendar.respond = () => ({ status: 500, body: 'down' });
    const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '10:30:00'), fakeRate: RATE });
    await sleep(75_000); // ≈ 37 minutes of service time
    const exit = s.exit;
    await s.stop();
    assert.equal(exit, null, `service stayed up:\n${s.output}`);
    const starts = clusterStarts(fake.calendar.requests.map((r) => r.at));
    assert.ok(starts.length >= 2, `calendar fetches seen: ${starts.length} (unknown is judged again after 10 minutes)`);
    for (let i = 1; i < starts.length; i++) {
        const gap = ((starts[i] - starts[i - 1]) / 1000) * RATE;
        assert.ok(gap >= 590, `calendar fetched again after ${Math.round(gap)} s of service time`);
    }
    assert.equal(fake.log.requests.length, 0, 'unknown → nothing sent');
});

test('RN-39 한 회차가 5분이 지나도 끝나지 않으면 서비스는 0 이 아닌 코드로 끝난다', { timeout: 480_000 }, async (t) => {
    // The history tables are locked: the round's history reads wait and the round cannot finish.
    const lock = await lockHistoryTables();
    try {
        const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '11:58:00') });
        let longest = 0;
        let lastWait = null;
        while (!s.exit) {
            const w = await lock.longestWaitSeconds();
            if (s.exit) break;
            if (w === null && longest > 0) {
                await s.stop();
                t.skip(`the waiting query ended after ${Math.round(longest)} s without the service ending — no round stayed stuck for 5 minutes, nothing to judge`);
                return;
            }
            if (w !== null) { longest = Math.max(longest, w); lastWait = w; }
            if (longest > 330) break;
            if (longest === 0 && Date.now() - s.startedAt > 60_000) break; // never reached the history
            await sleep(2000);
        }
        const exit = s.exit;
        await s.stop();
        assert.ok(longest > 0, `precondition: a query of the service waited on the locked history:\n${s.output}`);
        assert.ok(exit, `a round has been stuck for ${Math.round(longest)} s and the service is still running`);
        assert.notEqual(exit.code, 0, `exit ${JSON.stringify(exit)}`);
        assert.ok(s.exitAt - s.startedAt >= 298_000, `ended ${Math.round((s.exitAt - s.startedAt) / 1000)} s after start — before any round could be 5 minutes old`);
        assert.ok(lastWait <= 332, `the stuck query had waited ${lastWait} s`);
    } finally { await lock.release(); }
});

/** Holds the first log API request `holdMs`, answers the rest at once. */
function holdFirstRequest(holdMs) {
    const st = { request: null, answeredAt: null };
    fake.log.respond = async (rec) => {
        if (st.request) return logReply('AP1002');
        st.request = rec;
        await sleep(holdMs);
        st.answeredAt = Date.now();
        return logReply('AP1002');
    };
    return st;
}
async function until(cond, ms) { for (let i = 0; i < ms / 200 && !cond(); i++) await sleep(200); return cond(); }

test('RN-40 종료 신호를 받으면 진행 중인 회차가 끝나기를 최대 15초 기다린 뒤 끝난다', { timeout: 120_000 }, async () => {
    // a round that finishes 6 s after the signal: the service waits for it, and the sent result is in the history
    const st = holdFirstRequest(6000);
    const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '11:58:00') });
    assert.ok(await until(() => st.request, 20_000), `precondition: a step was being sent:\n${s.output}`);
    await sleep(500);
    const signalAt = Date.now();
    s.kill('SIGTERM');
    const exit = await s.waitExit(25_000);
    assert.ok(exit, 'the service ended after the signal');
    assert.ok(s.exitAt - signalAt <= 18_000, `ended ${s.exitAt - signalAt} ms after the signal`);
    assert.ok(st.answeredAt && s.exitAt >= st.answeredAt, 'the service ended before the running round received its answer');
    const code = ROSTER.find((c) => c.sysUser === st.request.fields.sysUser).code;
    const rows = (await historyRows(code)).filter((r) => r.log_dt === st.request.fields.logDt);
    assert.equal(rows.length, 1, 'the result of the request in flight is in the history');
    assert.equal(rows[0].result_code, 'AP1002');
    // a round still running 15 s after the signal: the service ends anyway
    fake.reset();
    await resetHistory();
    await clearDedicated();
    const st2 = holdFirstRequest(40_000);
    const s2 = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10' }), { fakeNow: kstAt(D, '11:58:00') });
    assert.ok(await until(() => st2.request, 20_000), `precondition: a step was being sent:\n${s2.output}`);
    await sleep(500);
    const signal2 = Date.now();
    s2.kill('SIGTERM');
    const exit2 = await s2.waitExit(25_000);
    assert.ok(exit2, 'the service ended while its round was still running');
    assert.ok(s2.exitAt - signal2 <= 18_000, `ended ${s2.exitAt - signal2} ms after the signal`);
});

test('RN-41 SF_DAILY_ENABLED=true 인데 SF_DAILY_FAKE_NOW 가 있으면 서비스는 시작하지 않는다', { timeout: 60_000 }, async () => {
    const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10', SF_DAILY_FAKE_NOW: kstAt(D, '11:58:00').toISOString() }));
    const exit = await s.waitExit(15_000);
    await s.stop();
    assert.ok(exit, `the service is running:\n${s.output}`);
    assert.equal(fake.log.requests.length, 0, 'nothing was sent');
});
