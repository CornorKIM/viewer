// Gates for docs/spec/interfaces/sf-log-api.md (제품 밖 · 읽기 전용) — what our side must do against the
// log API, judged at the fake log API. See GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { useSendingWorld, req } from '../../lib/sending.js';
import { resetHistory, clearDedicated } from '../../lib/db.js';
import { logReply, LOG_HOST, LOG_PATH } from '../../lib/fake-internet.js';
import { byCode } from '../../lib/roster.js';
import { kstLogDt } from '../../lib/kst.js';

const world = useSendingWorld();

test('IA-01 요청은 계약 주소로 POST, form-urlencoded UTF-8 본문에 여섯 필드', async () => {
    const send = await fn('step-sender', 'sendStep');
    await send(req('CDR', 'login'));
    assert.equal(world.fake.log.requests.length, 1);
    const q = world.fake.log.requests[0];
    assert.deepEqual([q.method, q.host, q.url.split('?')[0]], ['POST', LOG_HOST, LOG_PATH]);
    const ct = String(q.headers['content-type'] || '').toLowerCase().replace(/\s+/g, '');
    assert.ok(ct.startsWith('application/x-www-form-urlencoded'), ct);
    assert.match(ct, /charset=utf-8/);
    for (const k of ['crtfcKey', 'logDt', 'useSe', 'sysUser', 'conectIp', 'dataUsgqty']) assert.ok(q.fields?.[k] !== undefined && q.fields[k] !== '', `field ${k}`);
    assert.equal(q.fields.sysUser, byCode('CDR').sysUser, 'Korean value survives UTF-8 encoding');
    assert.ok([...q.fields.sysUser].length <= 60 && q.fields.conectIp.length <= 30);
    assert.match(q.fields.dataUsgqty, /^\d+$/);
});

test('IA-02 logDt 는 23자 YYYY-MM-DD HH:MI:SS.SSS 의 KST 시각이다', async () => {
    const send = await fn('step-sender', 'sendStep');
    const t0 = Date.now();
    await send(req('A', 'login'));
    const t1 = Date.now();
    const { logDt } = world.fake.log.requests[0].fields;
    assert.equal(logDt.length, 23);
    assert.match(logDt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{3}$/);
    assert.ok(logDt >= kstLogDt(new Date(t0 - 1000)) && logDt <= kstLogDt(new Date(t1 + 1000)), `${logDt} is KST now`);
});

test('IA-03 응답에 result 가 없으면 최상위의 같은 이름을 읽는다', async () => {
    const send = await fn('step-sender', 'sendStep');
    world.fake.log.respond = () => logReply('AP1002', { nested: false, msg: '최상위 정상' });
    const a = await send(req('A', 'login'));
    assert.deepEqual([a.outcome, a.resultCode, a.message], ['stored', 'AP1002', '최상위 정상']);
    world.fake.log.respond = () => logReply('AP1027', { nested: false });
    const b = await send(req('B', 'login'));
    assert.deepEqual([b.outcome, b.resultCode], ['error_response', 'AP1027']);
});

test('IA-04 AP1002 가 아닌 결과 코드는 모두 오류 응답이다', { timeout: 60_000 }, async () => {
    const send = await fn('step-sender', 'sendStep');
    for (const code of ['AP1027', 'AP1029', 'AP1003', 'AP1011', 'AP1030', 'AP1031', 'AP1032', 'AP1099', 'AP9999']) {
        await resetHistory();
        await clearDedicated();
        world.fake.log.respond = () => logReply(code);
        const r = await send(req('D', 'login'));
        assert.deepEqual([code, r.outcome, r.resultCode], [code, 'error_response', code]);
    }
});
