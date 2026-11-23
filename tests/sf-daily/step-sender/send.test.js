// Gates for docs/spec/sf-daily/spec/step-sender.md — see GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { useSendingWorld, req, seedPrevious } from '../../lib/sending.js';
import { insertHistory, historyRows, allHistoryRows, failHistoryWrites } from '../../lib/db.js';
import { logReply } from '../../lib/fake-internet.js';
import { TEST_IP, keyOf, secrets } from '../../lib/env.js';
import { byCode, useSeOf } from '../../lib/roster.js';
import { kstToday, kstDate, kstLogDt, addDays, MIN, sleep } from '../../lib/kst.js';

const world = useSendingWorld();
const sendStep = () => fn('step-sender', 'sendStep');
const totalRows = async () => { const r = await allHistoryRows(); return r.tp23.length + r.tp1.length; };

async function expectNotSent(request, outcome) {
    const send = await sendStep();
    const before = await totalRows();
    const r = await send(request);
    assert.equal(r.outcome, outcome);
    assert.equal(world.fake.log.requests.length, 0, 'nothing reached the log API');
    assert.equal(await totalRows(), before, 'no history row was added');
    return r;
}

test('SS-01 요청의 그날이 지금의 KST 날짜와 다르면 지난 날 — 보내지 않고 이력도 없다', async () => {
    await expectNotSent(req('A', 'login', { date: addDays(kstToday(), -1) }), 'past_day');
    await expectNotSent(req('B', 'login', { date: addDays(kstToday(), 1) }), 'past_day');
});

test('SS-02 지금이 보내는 범위의 끝 시각 이후면 범위 지남 — 보내지 않고 이력도 없다', async () => {
    await expectNotSent(req('A', 'login', { windowEnd: new Date(Date.now() - 1000) }), 'window_passed');
});

test('SS-03 ASS-09 앞 단계의 그날 정상 저장 건수가 0 이면 앞 단계 없음 — 보내지 않고 이력도 없다', async () => {
    await expectNotSent(req('A', 'query'), 'previous_missing');
    // login stored but query not → logout has no previous step
    await insertHistory('B', { useSe: 'DO6001', minutesAgo: 30 });
    await expectNotSent(req('B', 'logout'), 'previous_missing');
    // rows that are not a normal save of the previous step today do not count
    await insertHistory('C', { useSe: 'DO6001', resultCode: 'AP1029', minutesAgo: 30 });
    await insertHistory('C', { useSe: 'DO6001', test: true, minutesAgo: 31 });
    await insertHistory('C', { useSe: 'DO6999', minutesAgo: 32 });
    await expectNotSent(req('C', 'query'), 'previous_missing');
});

test('SS-04 로그인 단계는 앞 단계 확인에 걸리지 않는다', async () => {
    const send = await sendStep();
    const r = await send(req('A', 'login'));
    assert.equal(r.outcome, 'stored');
    assert.equal(world.fake.log.requests.length, 1);
});

test('SS-05 이 단계의 그날 정상 저장 건수가 1 이상이면 이미 저장됨 — 보내지 않고 이력도 없다', async () => {
    await insertHistory('A', { useSe: 'DO6001', minutesAgo: 30 });
    await expectNotSent(req('A', 'login'), 'already_stored');
    await seedPrevious('D', 'logout', 60);
    await insertHistory('D', { useSe: 'DO6002', minutesAgo: 20 });
    await expectNotSent(req('D', 'logout'), 'already_stored');
});

test('SS-06 그날 정상 저장 건수는 자동 전송 · 뷰어 화면 로그인 · Vercel 쪽 전송을 모두 센다', async () => {
    // tp1 rows written by the viewer screen (source login) and by others (source sensor) count
    await insertHistory('CDR', { useSe: 'DO6001', source: 'login', minutesAgo: 40 });
    await expectNotSent(req('CDR', 'login'), 'already_stored');
    await insertHistory('CDR', { useSe: 'DO6003', source: 'sensor', minutesAgo: 30 });
    await expectNotSent(req('CDR', 'query'), 'already_stored');
    // tp23 rows with no auto-send mark (viewer / Vercel) count
    await insertHistory('B', { useSe: 'DO6001', minutesAgo: 30 });
    await expectNotSent(req('B', 'login'), 'already_stored');
});

test('SS-07 IH-05 이 업체의 가장 최근 요청이 10분 안이면 10분 대기 — 시험 · 오류 행도, 쓴 순서와 무관하게 가장 큰 sent_at 으로 잰다', async () => {
    await insertHistory('A', { useSe: 'DO6999', test: true, resultCode: 'AP1002', minutesAgo: 5 });
    await expectNotSent(req('A', 'login'), 'wait_10min');
    await insertHistory('B', { useSe: 'DO6001', resultCode: null, error: 'send_failed: timeout', minutesAgo: 3 });
    await expectNotSent(req('B', 'login'), 'wait_10min');
    // larger id but older sent_at: the 4-minute-old row (smaller id) still decides
    await insertHistory('CDR', { useSe: 'DO6001', resultCode: 'AP1029', minutesAgo: 4, id: 100 });
    await insertHistory('CDR', { useSe: 'DO6004', resultCode: 'AP1002', minutesAgo: 50, id: 200 });
    await expectNotSent(req('CDR', 'login'), 'wait_10min');
});

test('SS-08 다른 업체의 최근 요청이나 10분이 지난 요청은 막지 않는다', async () => {
    const send = await sendStep();
    await insertHistory('B', { useSe: 'DO6001', minutesAgo: 1 });
    await insertHistory('A', { useSe: 'DO6999', test: true, minutesAgo: 11 });
    const r = await send(req('A', 'login'));
    assert.equal(r.outcome, 'stored');
    assert.equal(world.fake.log.requests.length, 1);
});

test('SS-09 확인은 지난 날 → 범위 지남 → 앞 단계 없음 → 이미 저장됨 → 10분 대기 순서다', async () => {
    // 1 before 2, 4
    await insertHistory('A', { useSe: 'DO6001', minutesAgo: 30 });
    await expectNotSent(req('A', 'login', { date: addDays(kstToday(), -1), windowEnd: new Date(Date.now() - 1000) }), 'past_day');
    // 2 before 3
    await expectNotSent(req('B', 'query', { windowEnd: new Date(Date.now() - 1000) }), 'window_passed');
    // 3 before 4 (logout already stored, query missing)
    await insertHistory('C', { useSe: 'DO6001', minutesAgo: 60 });
    await insertHistory('C', { useSe: 'DO6002', minutesAgo: 40 });
    await expectNotSent(req('C', 'logout'), 'previous_missing');
    // 4 before 5 (stored 2 minutes ago)
    await insertHistory('D', { useSe: 'DO6001', minutesAgo: 2 });
    await expectNotSent(req('D', 'login'), 'already_stored');
    // 3 before 5
    await insertHistory('CDR', { useSe: 'DO6999', test: true, minutesAgo: 1 });
    await expectNotSent(req('CDR', 'query'), 'previous_missing');
});

test('SS-10 보내는 로그의 값: 인증키 · 보내는 순간의 KST 로그 일시(날짜는 그날) · 단계 코드 · 시스템 사용자 · 접속 IP · 데이터 사용량 0', async () => {
    const send = await sendStep();
    await seedPrevious('A', 'query');
    const t0 = Date.now();
    const r = await send(req('A', 'query'));
    const t1 = Date.now();
    assert.equal(r.outcome, 'stored');
    const f = world.fake.log.requests[0].fields;
    assert.equal(f.crtfcKey, keyOf('A'));
    assert.match(f.logDt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    assert.ok(f.logDt >= kstLogDt(new Date(t0 - 1000)) && f.logDt <= kstLogDt(new Date(t1 + 1000)), `logDt ${f.logDt} is the sending moment`);
    assert.equal(f.logDt.slice(0, 10), kstToday());
    assert.equal(f.useSe, 'DO6003');
    assert.equal(f.sysUser, byCode('A').sysUser);
    assert.equal(f.conectIp, TEST_IP);
    assert.equal(f.dataUsgqty, '0');
});

test('SS-11 SF_LOG_DEFAULT_IP 가 없으면 접속 IP 는 175.193.55.102 다', { timeout: 60_000 }, async () => {
    const r = await callInChild('step-sender', 'sendStep', [req('B', 'login')], { env: { SF_LOG_DEFAULT_IP: null } });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.outcome, 'stored');
    assert.equal(world.fake.log.requests.length, 1);
    assert.equal(world.fake.log.requests[0].fields.conectIp, '175.193.55.102');
});

test('SS-12 ASS-05 같은 업체 · 그날 · 단계로 동시에 온 요청은 사업관리시스템에 하나만 나가고 나머지는 이미 진행 중 또는 이미 저장됨', { timeout: 60_000 }, async () => {
    const send = await sendStep();
    world.fake.log.respond = () => ({ ...logReply('AP1002'), delayMs: 800 });
    const r = req('C', 'login');
    const [a, b, c] = await Promise.all([send(r), send(r), callInChild('step-sender', 'sendStep', [r])]);
    assert.ok(c.ok, JSON.stringify(c.error));
    const outcomes = [a.outcome, b.outcome, c.value.outcome];
    assert.equal(world.fake.log.requests.length, 1, `requests reaching the log API (outcomes ${outcomes})`);
    assert.equal(outcomes.filter((o) => o === 'stored').length, 1, `outcomes ${outcomes}`);
    for (const o of outcomes.filter((x) => x !== 'stored')) assert.ok(['in_progress', 'already_stored'].includes(o), `outcome ${o}`);
});

test('SS-13 결과 코드 AP1002 는 정상 저장, 그 밖의 코드는 오류 응답 — 결과 코드와 문구를 돌려준다', async () => {
    const send = await sendStep();
    world.fake.log.respond = () => logReply('AP1002', { msg: '정상적으로 저장되었습니다' });
    const ok = await send(req('A', 'login'));
    assert.deepEqual([ok.outcome, ok.resultCode, ok.message], ['stored', 'AP1002', '정상적으로 저장되었습니다']);
    world.fake.log.respond = () => logReply('AP1029', { msg: '10분 이내 재전송' });
    const bad = await send(req('B', 'login'));
    assert.deepEqual([bad.outcome, bad.resultCode, bad.message], ['error_response', 'AP1029', '10분 이내 재전송']);
});

test('SS-14 요청이 닿지 못했거나 응답을 읽지 못하면 전송 실패 — 결과 코드 없음, 사유 문구, 이력 한 행', async () => {
    const send = await sendStep();
    await world.fake.stop();
    const a = await send(req('A', 'login'));
    await world.fake.start();
    world.fake.log.respond = () => ({ status: 502, headers: { 'content-type': 'text/html' }, body: '<html>Bad Gateway</html>' });
    const b = await send(req('CDR', 'login'));
    world.fake.log.respond = () => ({ destroy: true });
    const c = await send(req('D', 'login'));
    for (const [code, r] of [['A', a], ['CDR', b], ['D', c]]) {
        assert.equal(r.outcome, 'send_failed', `${code}`);
        assert.equal(r.resultCode, null);
        assert.equal(typeof r.message, 'string');
        const rows = await historyRows(code);
        assert.equal(rows.length, 1, `${code} one history row`);
        assert.equal(rows[0].result_code, null);
        assert.ok(rows[0].error, `${code} row error column says why`);
    }
});

test('SS-15 ASS-07 보낸 요청 하나마다 이력 한 행 — 보낸 값과 응답이 열에 남는다', async () => {
    const send = await sendStep();
    world.fake.log.respond = (rq) => logReply(rq.fields.sysUser === byCode('B').sysUser ? 'AP1031' : 'AP1002');
    for (const code of ['A', 'B', 'CDR']) {
        const r = await send(req(code, 'login'));
        const rows = await historyRows(code);
        assert.equal(rows.length, 1, `${code} one row`);
        const row = rows[0];
        const sent = world.fake.log.requests.find((q) => q.fields.sysUser === byCode(code).sysUser).fields;
        assert.equal(row.use_se, 'DO6001');
        assert.equal(row.log_dt, sent.logDt);
        assert.equal(row.sys_user, byCode(code).sysUser);
        assert.equal(row.conect_ip, TEST_IP);
        assert.equal(Number(row.data_usgqty), 0);
        assert.equal(row.test, false);
        assert.equal(row.result_code, r.resultCode);
        assert.equal(row.http_status, 200);
        assert.equal(kstDate(row.sent_at), kstToday());
        if (code === 'CDR') assert.equal(row.company_code, 'CDR'); else assert.equal(row.set_code, code);
    }
    // outcomes that do not send leave nothing (also SS-01…09)
    const before = await totalRows();
    await send(req('A', 'login'));
    assert.equal(await totalRows(), before);
});

test('SS-16 CO-12 ASS-06 IH-07 인증키는 이력 행의 어느 열에도, 보내기 결과에도 없다', async () => {
    const send = await sendStep();
    const results = [];
    results.push(await send(req('A', 'login')));
    world.fake.log.respond = (rq) => logReply('AP1003', { msg: `인증키 불일치` });
    results.push(await send(req('CDR', 'login')));
    await world.fake.stop();
    results.push(await send(req('B', 'login')));
    await world.fake.start();
    const all = await allHistoryRows();
    const dump = JSON.stringify([...all.tp23, ...all.tp1]);
    const out = JSON.stringify(results);
    assert.ok(all.tp23.length + all.tp1.length >= 3, 'rows were written');
    for (const s of secrets()) {
        assert.ok(!dump.includes(s), 'secret in a history row');
        assert.ok(!out.includes(s), 'secret in a sendStep result');
    }
});

test('SS-17 ASS-08 로그 일시의 날짜는 요청의 그날과 같다 — 세 단계 모두', async () => {
    const send = await sendStep();
    await send(req('A', 'login'));
    await seedPrevious('B', 'query');
    await send(req('B', 'query'));
    await seedPrevious('C', 'logout');
    await send(req('C', 'logout'));
    assert.equal(world.fake.log.requests.length, 3);
    for (const q of world.fake.log.requests) assert.equal(q.fields.logDt.slice(0, 10), kstToday());
    assert.deepEqual(world.fake.log.requests.map((q) => q.fields.useSe), [useSeOf('login'), useSeOf('query'), useSeOf('logout')]);
});

test('SS-19 응답 전에 보내던 프로세스가 죽어도(결과 코드 없는 일지 건) 그 단계는 이미 저장됨 — 다시 보내지 않는다', { timeout: 60_000 }, async () => {
    const killer = new AbortController();
    world.fake.log.respond = async () => { killer.abort(); await sleep(3000); return logReply('AP1002'); };
    const first = await callInChild('step-sender', 'sendStep', [req('A', 'login')], { signal: killer.signal });
    assert.equal(first.killed, true, 'the sending process was killed before it read the answer');
    assert.equal(world.fake.log.requests.length, 1, 'the request reached the log API');
    assert.equal((await historyRows('A')).length, 0, 'precondition: the killed sender left no history row');
    world.fake.log.respond = () => logReply('AP1002');
    const again = await (await sendStep())(req('A', 'login'));
    assert.equal(again.outcome, 'already_stored');
    assert.equal(world.fake.log.requests.length, 1, 'the step was not sent a second time');
});

test('SS-20 응답의 결과 코드가 일지 건에 적힌다 — AP1002 가 아닌 응답 뒤 같은 단계는 이미 저장됨이 아니라 10분 대기', async () => {
    const send = await sendStep();
    world.fake.log.respond = () => logReply('AP1029');
    const a = await send(req('A', 'login'));
    assert.equal(a.outcome, 'error_response');
    const b = await send(req('A', 'login'));
    assert.equal(b.outcome, 'wait_10min');
    assert.equal(world.fake.log.requests.length, 1);
});

test('SS-21 결과 코드가 AP1002 인 일지 건은 이력 행이 없어도 확인 4 에서 정상 저장 — 이미 저장됨', async () => {
    const send = await sendStep();
    await failHistoryWrites(true);
    try {
        await send(req('A', 'login')).catch(() => null);
        assert.equal(world.fake.log.requests.length, 1, 'the login was sent');
        assert.equal((await historyRows('A')).length, 0, 'precondition: the history write failed');
        const again = await send(req('A', 'login'));
        assert.equal(again.outcome, 'already_stored');
        assert.equal(world.fake.log.requests.length, 1, 'not sent a second time');
    } finally { await failHistoryWrites(false); }
});

test('SS-22 일지 건의 요청 시각은 확인 5 에서 그 업체의 요청이다 — 이력 행이 없어도 10분 대기', async () => {
    const send = await sendStep();
    await seedPrevious('A', 'query'); // login stored 25 minutes ago: the history alone would allow a send
    await failHistoryWrites(true);
    try {
        world.fake.log.respond = () => logReply('AP1029');
        await send(req('A', 'query')).catch(() => null);
        assert.equal(world.fake.log.requests.length, 1, 'the query was sent');
        assert.equal((await historyRows('A')).length, 1, 'precondition: only the seeded login is in the history');
        const again = await send(req('A', 'query'));
        assert.equal(again.outcome, 'wait_10min');
        assert.equal(world.fake.log.requests.length, 1, 'not sent a second time');
    } finally { await failHistoryWrites(false); }
});

test('SS-23 이력 행 쓰기가 실패한 요청은 다음 보내기 요청 때 이력에 다시 쓰인다', async () => {
    const send = await sendStep();
    await failHistoryWrites(true);
    try {
        await send(req('A', 'login')).catch(() => null);
    } finally { await failHistoryWrites(false); }
    assert.equal(world.fake.log.requests.length, 1, 'the login was sent');
    const sent = world.fake.log.requests[0].fields;
    assert.equal((await historyRows('A')).length, 0, 'precondition: the history write failed');
    await send(req('A', 'login')).catch(() => null); // the next send request
    const rows = (await historyRows('A')).filter((r) => r.log_dt === sent.logDt);
    assert.equal(rows.length, 1, 'the failed request has exactly one history row now');
    assert.equal(rows[0].use_se, 'DO6001');
    assert.equal(rows[0].result_code, 'AP1002');
});
