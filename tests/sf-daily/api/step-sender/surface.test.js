// Gates for docs/spec/sf-daily/api/step-sender.md — see GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../../lib/sut.js';
import { callInChild } from '../../../lib/child.js';
import { useSendingWorld, req } from '../../../lib/sending.js';
import { insertHistory } from '../../../lib/db.js';
import { logReply } from '../../../lib/fake-internet.js';
import { kstToday, addDays } from '../../../lib/kst.js';

const world = useSendingWorld();
const OUTCOMES = ['stored', 'error_response', 'send_failed', 'past_day', 'window_passed', 'previous_missing', 'already_stored', 'wait_10min', 'in_progress'];
const SENT = ['stored', 'error_response', 'send_failed'];

function assertResult(r) {
    assert.ok(OUTCOMES.includes(r.outcome), `outcome ${r.outcome}`);
    assert.ok('resultCode' in r && 'message' in r, 'resultCode and message are present');
    assert.ok(r.resultCode === null || typeof r.resultCode === 'string');
    assert.ok(r.message === null || typeof r.message === 'string');
    if (!SENT.includes(r.outcome) || r.outcome === 'send_failed') assert.equal(r.resultCode, null, `${r.outcome} has no result code`);
}

test('ASS-01 결과는 outcome · resultCode · message 이고, 보내지 않았거나 응답이 없으면 resultCode 는 null', async () => {
    const send = await fn('step-sender', 'sendStep');
    const results = [];
    results.push(await send(req('A', 'login'))); // stored
    world.fake.log.respond = () => logReply('AP1030');
    results.push(await send(req('B', 'login'))); // error_response
    await world.fake.stop();
    results.push(await send(req('C', 'login'))); // send_failed
    await world.fake.start();
    results.push(await send(req('D', 'login', { date: addDays(kstToday(), -1) }))); // past_day
    results.push(await send(req('D', 'login', { windowEnd: new Date(Date.now() - 1000) }))); // window_passed
    results.push(await send(req('D', 'query'))); // previous_missing
    results.push(await send(req('A', 'login'))); // already_stored
    await insertHistory('CDR', { useSe: 'DO6999', test: true, minutesAgo: 2 });
    results.push(await send(req('CDR', 'login'))); // wait_10min
    assert.deepEqual(results.map((r) => r.outcome), ['stored', 'error_response', 'send_failed', 'past_day', 'window_passed', 'previous_missing', 'already_stored', 'wait_10min']);
    results.forEach(assertResult);
    assert.equal(results[0].resultCode, 'AP1002');
    assert.equal(results[1].resultCode, 'AP1030');
});

test('ASS-02 요청 필드가 없거나 값이 표 밖이면 TypeError 로 거부하고 아무것도 보내지 않는다', async () => {
    const send = await fn('step-sender', 'sendStep');
    const good = req('A', 'login');
    const bad = [
        undefined,
        {},
        { ...good, company: undefined },
        { ...good, company: 'Z' },
        { ...good, date: undefined },
        { ...good, date: '2026-1-5' },
        { ...good, date: '2026-02-30' },
        { ...good, step: undefined },
        { ...good, step: 'LOGIN' },
        { ...good, windowEnd: undefined },
        { ...good, windowEnd: good.windowEnd.toISOString() },
        { ...good, windowEnd: new Date('x') },
    ];
    for (const b of bad) await assert.rejects(async () => send(b), TypeError, JSON.stringify(b));
    assert.equal(world.fake.log.requests.length, 0);
});

test('ASS-03 전송 이력 DB 에 닿지 못해 확인을 못 하면 TypeError 가 아닌 Error 로 거부하고 보내지 않는다', { timeout: 60_000 }, async () => {
    const r = await callInChild('step-sender', 'sendStep', [req('A', 'login')], { env: { PG_HOST: '127.0.0.1' } });
    assert.equal(r.ok, false, `rejected (got ${JSON.stringify(r.value)})`);
    assert.equal(r.error.isError, true);
    assert.equal(r.error.isTypeError, false);
    assert.equal(world.fake.log.requests.length, 0);
});

test('ASS-04 사업관리시스템 오류 · 닿지 못함은 거부가 아니라 정상 결과(error_response · send_failed)로 돌아온다', async () => {
    const send = await fn('step-sender', 'sendStep');
    world.fake.log.respond = () => logReply('AP1027');
    const a = await send(req('A', 'login'));
    world.fake.log.respond = () => ({ destroy: true });
    const b = await send(req('B', 'login'));
    assert.deepEqual([a.outcome, b.outcome], ['error_response', 'send_failed']);
});
