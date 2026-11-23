// Gates for docs/spec/sf-daily/spec/status-mail.md — see GATES.md in this folder.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { useMailWorld, seedCounts, viewMail } from '../../lib/mail.js';
import { insertHistory } from '../../lib/db.js';
import { REPORT_TO, secrets } from '../../lib/env.js';
import { ROSTER, byCode } from '../../lib/roster.js';
import { kstAt, addDays } from '../../lib/kst.js';

const LINK = 'https://gate.example.test/sflog-gate.html';
const world = useMailWorld({ SF_REPORT_LINK: LINK });
const D = '2026-11-24';
const ALL_LOGGED = { A: [1, 1, 1], B: [1, 1, 0], C: [2, 1, 1], D: [1, 0, 0], CDR: [1, 1, 1] };

async function sendFor(date, counts) {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    if (counts) await seedCounts(date, counts);
    const r = await sendStatusMail(date);
    return r;
}
function onlyMail() {
    assert.equal(world.smtp.messages.length, 1, 'exactly one mail reached the mail server');
    return viewMail(world.smtp.messages[0]);
}

test('SM-01 본문 표의 줄은 명부의 다섯 업체이고 순서도 명부 순서다', async () => {
    const r = await sendFor(D, ALL_LOGGED);
    assert.equal(r.outcome, 'sent');
    const v = onlyMail();
    const order = v.companyOrder();
    assert.ok(order.every((i) => i >= 0), `every company has a row (${order})`);
    assert.deepEqual([...order].sort((a, b) => a - b), order, 'rows follow the roster order');
});

test('SM-02 줄마다 업체 이름 · 유형 · 로그인 · 조회 · 로그아웃 건수가 있다', async () => {
    const counts = { A: [1, 2, 3], B: [2, 0, 1], C: [0, 0, 0], D: [3, 1, 0], CDR: [1, 3, 2] };
    await sendFor(D, counts);
    const v = onlyMail();
    assert.ok(v.header, 'a header row names the 로그인 · 조회 · 로그아웃 columns');
    for (const c of ROSTER) {
        assert.ok(v.rowOf(c.code).text.includes(c.type), `${c.code} row shows ${c.type}`);
        assert.deepEqual(v.counts(c.code), counts[c.code].map(String), `${c.code} counts`);
    }
});

test('SM-03 IH-02 건수는 그날 그 업체 · 그 단계의 정상 저장 건수다 (전송 이력의 셈)', async () => {
    const at = (date, hms) => kstAt(date, hms);
    // A login: counts → KST-day edges, any writer; not counted → test, non-AP1002, other day, other code
    await insertHistory('A', { useSe: 'DO6001', sentAt: at(D, '00:00:05') });
    await insertHistory('A', { useSe: 'DO6001', sentAt: at(D, '23:59:55') });
    await insertHistory('A', { useSe: 'DO6001', sentAt: at(addDays(D, -1), '23:59:55') });
    await insertHistory('A', { useSe: 'DO6001', sentAt: at(addDays(D, 1), '00:00:05') });
    await insertHistory('A', { useSe: 'DO6001', test: true, sentAt: at(D, '10:00') });
    await insertHistory('A', { useSe: 'DO6001', resultCode: 'AP1029', sentAt: at(D, '10:01') });
    await insertHistory('A', { useSe: 'DO6001', resultCode: null, error: 'send_failed', sentAt: at(D, '10:02') });
    await insertHistory('A', { useSe: 'DO6004', sentAt: at(D, '10:03') });
    await insertHistory('A', { useSe: 'DO6999', sentAt: at(D, '10:04') });
    await insertHistory('B', { useSe: 'DO6001', sentAt: at(D, '10:05') });
    // CDR: rows from the viewer screen and from auto sending both count
    await insertHistory('CDR', { useSe: 'DO6001', source: 'login', sentAt: at(D, '10:06') });
    await insertHistory('CDR', { useSe: 'DO6001', source: 'auto', sentAt: at(D, '10:07') });
    await insertHistory('CDR', { useSe: 'DO6002', source: 'logout', sentAt: at(D, '18:00') });
    await sendFor(D);
    const v = onlyMail();
    assert.deepEqual(v.counts('A'), ['2', '0', '0']);
    assert.deepEqual(v.counts('B'), ['1', '0', '0']);
    assert.deepEqual(v.counts('CDR'), ['2', '0', '1']);
});

test('SM-04 로그인 건수가 0 인 줄은 빨간색이고 나머지 줄은 빨간색이 아니다', async () => {
    await sendFor(D, { A: [1, 1, 1], B: [0, 0, 0], C: [1, 0, 0], D: [0, 2, 1], CDR: [3, 1, 1] });
    const v = onlyMail();
    for (const c of ROSTER) assert.equal(v.isRed(c.code), ['B', 'D'].includes(c.code), `${c.code} red?`);
});

test('SM-05 ASM-01 로그인 0 인 업체가 있으면 본문 맨 위에 「수동 로그인 필요:」 와 그 업체 이름들이 나온다', async () => {
    const r = await sendFor(D, { A: [1, 1, 1], B: [0, 0, 0], C: [1, 0, 0], D: [0, 2, 1], CDR: [1, 1, 1] });
    assert.deepEqual(r.missingLogin, ['B', 'D']);
    const v = onlyMail();
    assert.ok(v.visible.startsWith('수동 로그인 필요:'), `body starts with the warning: ${v.visible.slice(0, 80)}`);
    for (const code of ['B', 'D']) assert.ok(v.top.includes(byCode(code).name), `${code} named above the table`);
    for (const code of ['A', 'C', 'CDR']) assert.ok(!v.top.includes(byCode(code).name), `${code} not named above the table`);
});

test('SM-06 로그인 0 인 업체가 있으면 제목 앞에 「[로그인 누락]」 이 붙는다', async () => {
    await sendFor(D, { A: [1, 1, 1], B: [1, 1, 1], C: [1, 1, 1], D: [1, 1, 1], CDR: [0, 0, 0] });
    const v = onlyMail();
    assert.ok(v.subject.startsWith('[로그인 누락]'), v.subject);
    assert.equal(v.subject.slice('[로그인 누락]'.length).trim(), `스마트공장 로그 현황 ${D}`);
});

test('SM-07 로그인 0 인 업체가 없으면 본문 맨 위에 「모든 업체 로그인 정상」 이 나오고 제목에 누락 표시가 없다', async () => {
    const r = await sendFor(D, ALL_LOGGED);
    assert.deepEqual(r.missingLogin, []);
    const v = onlyMail();
    assert.ok(v.visible.startsWith('모든 업체 로그인 정상'), v.visible.slice(0, 80));
    assert.ok(!v.visible.includes('수동 로그인 필요'));
    assert.ok(!v.subject.includes('[로그인 누락]'), v.subject);
    for (const c of ROSTER) assert.equal(v.isRed(c.code), false, `${c.code} not red`);
});

test('SM-08 제목은 「스마트공장 로그 현황 YYYY-MM-DD」 이고 날짜는 그날이다', async () => {
    const date = '2026-12-01';
    await sendFor(date, ALL_LOGGED);
    assert.equal(onlyMail().subject, `스마트공장 로그 현황 ${date}`);
});

test('SM-09 본문에 SF_REPORT_LINK 주소가 들어 있다', async () => {
    await sendFor(D, ALL_LOGGED);
    assert.ok(onlyMail().html.includes(LINK));
});

test('SM-10 SF_REPORT_LINK 가 없으면 본문에 https://twin.smartline.kr/sflog.html 이 들어 있다', { timeout: 60_000 }, async () => {
    await seedCounts(D, ALL_LOGGED);
    const r = await callInChild('status-mail', 'sendStatusMail', [D], { env: { SF_REPORT_LINK: null } });
    assert.ok(r.ok, JSON.stringify(r.error));
    assert.equal(r.value.outcome, 'sent');
    const v = onlyMail();
    assert.ok(v.html.includes('https://twin.smartline.kr/sflog.html'));
    assert.ok(!v.html.includes(LINK));
});

test('SM-11 CO-12 메일에 인증키 · 메일 계정 비밀번호가 들어 있지 않다', async () => {
    await sendFor(D, { A: [0, 0, 0], B: [1, 1, 1], C: [1, 0, 0], D: [1, 1, 1], CDR: [0, 1, 0] });
    const v = onlyMail();
    const everything = [v.parsed.rawText, v.subject, ...v.parsed.parts.map((p) => p.text)].join('\n');
    for (const s of secrets()) assert.ok(!everything.includes(s), 'a secret is in the mail');
});

test('SM-12 ASM-05 그날 메일을 이미 보냈으면 다시 요청해도 보내지 않고 이미 보냄', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, ALL_LOGGED);
    assert.equal((await sendStatusMail(D)).outcome, 'sent');
    const again = await sendStatusMail(D);
    const third = await sendStatusMail(D);
    assert.deepEqual([again.outcome, again.missingLogin], ['already_sent', []]);
    assert.equal(third.outcome, 'already_sent');
    assert.equal(world.smtp.messages.length, 1);
    // another date is independent
    assert.equal((await sendStatusMail(addDays(D, 1))).outcome, 'sent');
});

test('SM-13 서비스가 다시 시작된 뒤에도 같은 그날은 다시 보내지 않는다', { timeout: 60_000 }, async () => {
    await seedCounts(D, ALL_LOGGED);
    const first = await callInChild('status-mail', 'sendStatusMail', [D]);
    assert.ok(first.ok, JSON.stringify(first.error));
    assert.equal(first.value.outcome, 'sent');
    const second = await callInChild('status-mail', 'sendStatusMail', [D]);
    assert.ok(second.ok, JSON.stringify(second.error));
    assert.equal(second.value.outcome, 'already_sent');
    assert.equal(world.smtp.messages.length, 1);
});

test('SM-14 ASM-06 메일 서버가 받지 않았으면 실패이고 보낸 것으로 치지 않는다', async () => {
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await seedCounts(D, ALL_LOGGED);
    world.smtp.set({ authFail: true });
    const r = await sendStatusMail(D);
    assert.equal(r.outcome, 'failed');
    assert.equal(world.smtp.messages.length, 0);
    world.smtp.set({ authFail: false });
    const retry = await sendStatusMail(D);
    assert.equal(retry.outcome, 'sent', 'the failed attempt was not recorded as sent');
    assert.equal(world.smtp.messages.length, 1);
});

test('SM-15 메일 한 통이 SF_REPORT_TO 의 받는 사람 모두에게 간다', async () => {
    await sendFor(D, ALL_LOGGED);
    const m = world.smtp.messages;
    assert.equal(m.length, 1);
    assert.deepEqual([...m[0].rcpts].sort(), [...REPORT_TO].sort());
});
