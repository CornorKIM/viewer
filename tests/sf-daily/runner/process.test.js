// Gates for docs/spec/sf-daily/spec/runner.md that are judged on the service process itself
// (node sf-daily/main.js): start refusal, staying up, tick interval, stdout. See GATES.md.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { startService } from '../../lib/child.js';
import { serviceEnv, secrets, TEST_KEYS } from '../../lib/env.js';
import { startFakeInternet } from '../../lib/fake-internet.js';
import { startSmtpStub } from '../../lib/smtp-stub.js';
import { resetHistory, clearDedicated, closeDb } from '../../lib/db.js';
import { kstAt, sleep } from '../../lib/kst.js';

const D = '2026-11-24'; // a Tuesday, a business day in the stub calendar
const QUIET = kstAt(D, '03:00:00').toISOString(); // nothing is due at 03:00 KST
let fake;
let smtp;
const running = [];
before(async () => { fake = await startFakeInternet(); smtp = await startSmtpStub(); });
after(async () => { for (const s of running) await s.stop(); await fake.stop(); await smtp.close(); await closeDb(); });
beforeEach(async () => { await fake.start(); fake.reset(); smtp.reset(); await resetHistory(); await clearDedicated(); });

function start(env) { const s = startService(env); running.push(s); return s; }

/** The service must exit non-zero within 15 s and name every setting in `names`. */
async function refuses(overrides, names) {
    const s = start(serviceEnv({ SF_DAILY_FAKE_NOW: QUIET, ...overrides }));
    const exit = await s.waitExit(15_000);
    await s.stop();
    assert.ok(exit, `service did not stop with ${JSON.stringify(overrides)}`);
    assert.notEqual(exit.code, 0, 'exit code is not 0');
    for (const n of names) assert.ok(s.output.includes(n), `output names ${n}:\n${s.output}`);
}

/** The service must still be running after `ms`. */
async function staysUp(env, ms = 5000) {
    const s = start(env);
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
        SF_DAILY_ENABLED: 'false', SF_DAILY_FAKE_NOW: QUIET, PG_PASSWORD: process.env.PG_PASSWORD, SF_DB_URL: process.env.SF_DB_URL,
        PG_HOST: process.env.PG_HOST,
    });
    await off.stop();
    const on = await staysUp(serviceEnv({ SF_DAILY_FAKE_NOW: QUIET, SF_DAILY_TICK_SECONDS: null, SF_REPORT_AT: null, SF_LOG_DEFAULT_IP: null }));
    await on.stop();
    const unset = await staysUp(serviceEnv({ SF_DAILY_FAKE_NOW: QUIET, SF_DAILY_ENABLED: null, ...Object.fromEntries(Object.keys(TEST_KEYS).map((k) => [k, null])) }));
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

test('RN-12 시각을 확인하는 간격은 SF_DAILY_TICK_SECONDS 초다', { timeout: 90_000 }, async () => {
    // Calendar down → every round judges "unknown" and judges again next round (one calendar fetch burst per round).
    fake.calendar.respond = () => ({ status: 500, body: 'down' });
    const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10', SF_DAILY_FAKE_NOW: kstAt(D, '11:58:00').toISOString() }));
    await sleep(34_000);
    const exit = s.exit;
    await s.stop();
    assert.equal(exit, null, `service stayed up:\n${s.output}`);
    const starts = clusterStarts(fake.calendar.requests.map((r) => r.at));
    assert.ok(starts.length >= 3, `rounds seen: ${starts.length}`);
    for (let i = 1; i < starts.length; i++) {
        const gap = (starts[i] - starts[i - 1]) / 1000;
        assert.ok(gap >= 8 && gap <= 14, `round gap ${gap}s`);
    }
    assert.equal(fake.log.requests.length, 0, 'unknown → nothing sent');
});

test('RN-13 SF_DAILY_TICK_SECONDS 가 없으면 간격은 30 초다', { timeout: 120_000 }, async () => {
    fake.calendar.respond = () => ({ status: 500, body: 'down' });
    const s = start(serviceEnv({ SF_DAILY_TICK_SECONDS: null, SF_DAILY_FAKE_NOW: kstAt(D, '11:55:00').toISOString() }));
    await sleep(72_000);
    const exit = s.exit;
    await s.stop();
    assert.equal(exit, null, `service stayed up:\n${s.output}`);
    const starts = clusterStarts(fake.calendar.requests.map((r) => r.at));
    assert.ok(starts.length >= 2, `rounds seen: ${starts.length}`);
    for (let i = 1; i < starts.length; i++) {
        const gap = (starts[i] - starts[i - 1]) / 1000;
        assert.ok(gap >= 27 && gap <= 36, `round gap ${gap}s`);
    }
});

test('RN-14 CO-12 실행 기록(표준 출력)에 인증키 · 비밀번호가 나오지 않는다', { timeout: 90_000 }, async () => {
    const outputs = [];
    // steps due (A–D logins) at 11:58
    const a = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10', SF_DAILY_FAKE_NOW: kstAt(D, '11:58:00').toISOString() }));
    for (let i = 0; i < 30 && fake.log.requests.length === 0; i++) await sleep(500);
    await sleep(3000);
    await a.stop();
    outputs.push(a.output);
    assert.ok(fake.log.requests.length >= 1, `the service sent at least one step:\n${a.output}`);
    // mail due at 23:00
    const b = start(serviceEnv({ SF_DAILY_TICK_SECONDS: '10', SF_DAILY_FAKE_NOW: kstAt(D, '23:00:05').toISOString() }));
    for (let i = 0; i < 30 && smtp.messages.length === 0; i++) await sleep(500);
    await sleep(2000);
    await b.stop();
    outputs.push(b.output);
    assert.ok(smtp.messages.length >= 1, `the service sent the status mail:\n${b.output}`);
    const all = outputs.join('\n');
    assert.ok(all.trim().length > 0, 'the service wrote a run log');
    for (const sec of secrets()) assert.ok(!all.includes(sec), 'a secret is in the run log');
});
