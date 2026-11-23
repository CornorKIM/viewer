// Gates for docs/spec/interfaces/smtp-mail.md (제품 밖 · 읽기 전용) — what our side must do against the
// mail server, judged at the SMTP stub. See GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { useMailWorld, seedCounts } from '../../lib/mail.js';
import { startSmtpStub } from '../../lib/smtp-stub.js';
import { parseMessage } from '../../lib/mime.js';
import { SMTP, REPORT_TO } from '../../lib/env.js';

const world = useMailWorld();
const D = '2026-11-26';
const COUNTS = { A: [1, 1, 1], B: [1, 1, 1], C: [1, 1, 1], D: [1, 1, 1], CDR: [1, 1, 1] };

test('IM-01 SMTP_HOST:SMTP_PORT(기본 587)에 붙어 STARTTLS 뒤 SMTP_USER · SMTP_PASS 로 인증하고 SMTP_USER 로 보낸다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    assert.equal((await sendStatusMail(D)).outcome, 'sent');
    const m = world.smtp.messages[0];
    assert.ok(m, 'the stub on port 587 received the mail');
    const s = m.session;
    assert.ok(s.events.indexOf('STARTTLS') >= 0 && s.events.indexOf('STARTTLS') < s.events.indexOf('AUTH'), `order ${s.events}`);
    const ok = s.auth.find((a) => a.user !== undefined);
    assert.deepEqual([ok.tls, ok.user, ok.pass], [true, SMTP.user, SMTP.pass]);
    assert.equal(m.from, SMTP.user);
    assert.match(parseMessage(m.raw).from, new RegExp(SMTP.user.replace(/[.@]/g, '\\$&')));
});

test('IM-02 SMTP_PORT 를 주면 그 포트로 붙는다', { timeout: 60_000 }, async () => {
    const other = await startSmtpStub({ port: 2525, user: SMTP.user, pass: SMTP.pass });
    try {
        await seedCounts(D, COUNTS);
        const r = await callInChild('status-mail', 'sendStatusMail', [D], { env: { SMTP_PORT: '2525' } });
        assert.ok(r.ok, JSON.stringify(r.error));
        assert.equal(r.value.outcome, 'sent');
        assert.equal(other.messages.length, 1);
        assert.equal(world.smtp.messages.length, 0);
    } finally { await other.close(); }
});

test('IM-03 메일은 UTF-8 HTML 본문과 UTF-8 제목이다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    await sendStatusMail(D);
    const p = parseMessage(world.smtp.messages[0].raw);
    assert.ok(p.htmlParts.length >= 1, 'an HTML part');
    for (const h of p.htmlParts) assert.equal(h.charset, 'utf-8');
    assert.ok(p.html.includes('목공소 봄'), 'Korean text decodes from the HTML part');
    assert.ok(p.subject.includes('스마트공장 로그 현황'), `subject decodes as UTF-8: ${p.subject}`);
});

test('IM-04 STARTTLS 를 못 하면 실패 — 인증 정보를 평문으로 보내지 않는다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    world.smtp.set({ starttls: false });
    const r = await sendStatusMail(D);
    assert.equal(r.outcome, 'failed');
    assert.equal(world.smtp.messages.length, 0);
    for (const s of world.smtp.sessions) for (const a of s.auth) assert.ok(a.tls || a.pass === undefined, 'credentials went out in clear text');
});

test('IM-05 인증이 거부되면 실패다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    world.smtp.set({ authFail: true });
    assert.equal((await sendStatusMail(D)).outcome, 'failed');
    assert.equal(world.smtp.messages.length, 0);
});

test('IM-06 받는 사람 중 하나라도 거부되면 실패다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    world.smtp.set({ rejectRcpt: [REPORT_TO[1]] });
    assert.equal((await sendStatusMail(D)).outcome, 'failed');
});

test('IM-07 서버가 DATA 를 받아들이지 않으면(250 이 아님) 실패, 받아들이면 보냄', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, COUNTS);
    world.smtp.set({ dataReply: 554 });
    assert.equal((await sendStatusMail(D)).outcome, 'failed');
    world.smtp.set({ dataReply: 250 });
    assert.equal((await sendStatusMail(D)).outcome, 'sent');
});

test('IM-08 메일 서버에 닿지 못하면 실패다', { timeout: 60_000 }, async () => {
    await seedCounts(D, COUNTS);
    const r = await callInChild('status-mail', 'sendStatusMail', [D], { env: { SMTP_PORT: '2526' } });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.outcome, 'failed');
});
