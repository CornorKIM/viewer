// Gates for docs/spec/sf-daily/api/status-mail.md — see GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../../lib/sut.js';
import { callInChild } from '../../../lib/child.js';
import { useMailWorld, seedCounts } from '../../../lib/mail.js';
import { SMTP } from '../../../lib/env.js';

const world = useMailWorld();
const D = '2026-11-25';

test('ASM-02 같은 date 로 동시에 불러도 메일은 한 통 — 하나는 sent, 나머지는 already_sent', { timeout: 60_000 }, async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, { A: [1, 1, 1], B: [1, 1, 1], C: [1, 1, 1], D: [1, 1, 1], CDR: [1, 1, 1] });
    const [a, b, c] = await Promise.all([sendStatusMail(D), sendStatusMail(D), callInChild('status-mail', 'sendStatusMail', [D])]);
    assert.ok(c.ok, JSON.stringify(c.error));
    const outcomes = [a.outcome, b.outcome, c.value.outcome].sort();
    assert.deepEqual(outcomes, ['already_sent', 'already_sent', 'sent']);
    assert.equal(world.smtp.messages.length, 1);
});

test('ASM-03 DB 에 닿지 못하면 거부가 아니라 failed 로 돌아온다 (전용 DB · 전송 이력 DB)', { timeout: 60_000 }, async () => {
    for (const env of [{ SF_DB_URL: 'postgres://postgres:wrong@127.0.0.1:1/sfdaily' }, { PG_HOST: '127.0.0.1' }]) {
        const r = await callInChild('status-mail', 'sendStatusMail', [D], { env });
        assert.ok(r.ok, `resolved, not rejected (${JSON.stringify(r.error)}) with ${JSON.stringify(env)}`);
        assert.equal(r.value.outcome, 'failed');
        assert.equal(typeof r.value.error, 'string');
    }
});

test('ASM-04 date 형식이 틀리면 TypeError 로 거부한다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    for (const bad of ['2026-13-01', '2026-02-30', '20261125', '', undefined, null, new Date()]) {
        await assert.rejects(async () => sendStatusMail(bad), TypeError, String(bad));
    }
    assert.equal(world.smtp.messages.length, 0);
});

test('ASM-07 failed 의 error 는 사유 문자열이고 비밀번호를 담지 않는다 · sent 의 error 는 null', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    world.smtp.set({ authFail: true });
    const f = await sendStatusMail(D);
    assert.equal(f.outcome, 'failed');
    assert.equal(typeof f.error, 'string');
    assert.ok(f.error.length > 0);
    assert.ok(!f.error.includes(SMTP.pass), 'password in the error');
    assert.ok(Array.isArray(f.missingLogin));
    world.smtp.set({ authFail: false });
    const s = await sendStatusMail(D);
    assert.deepEqual([s.outcome, s.error], ['sent', null]);
    assert.ok(Array.isArray(s.missingLogin) && s.missingLogin.every((x) => typeof x === 'string'));
});
