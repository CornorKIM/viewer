// Gates for docs/spec/interfaces/sf-log-history.md — sf-daily's side of the shared history tables
// (a throwaway copy with the exact DDL). See GATES.md in this folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { fn } from '../../lib/sut.js';
import { useSendingWorld, req, seedPrevious } from '../../lib/sending.js';
import { insertHistory, historySchemaSnapshot, allHistoryRows, dedicatedHolds, history } from '../../lib/db.js';
import { startSmtpStub } from '../../lib/smtp-stub.js';
import { kstToday } from '../../lib/kst.js';

const world = useSendingWorld();
let smtp;
before(async () => { smtp = await startSmtpStub(); });
after(async () => { await smtp.close(); });

test('IH-01 sf-daily 는 전송 이력 DB 에 스키마 · 테이블 · 열 · 인덱스를 만들거나 바꾸지 않는다', { timeout: 60_000 }, async () => {
    const before = await historySchemaSnapshot();
    const sendStep = await fn('step-sender', 'sendStep');
    const getDailyPlan = await fn('daily-plan', 'getDailyPlan');
    const sendStatusMail = await fn('status-mail', 'sendStatusMail');
    await sendStep(req('A', 'login'));
    await sendStep(req('CDR', 'login'));
    await seedPrevious('B', 'query');
    await sendStep(req('B', 'query'));
    await getDailyPlan(kstToday());
    await sendStatusMail(kstToday());
    assert.equal(await historySchemaSnapshot(), before);
});

test('IH-04 SS-18 자동 전송 행의 구별: 유형1 은 source = auto, 유형2-3 은 그 행의 id 가 전용 DB 에 있다', async () => {
    const send = await fn('step-sender', 'sendStep');
    // a viewer-written row with a distinctive id, and a distinctive id for the next auto row
    const viewerId = await insertHistory('C', { useSe: 'DO6001', minutesAgo: 40, id: 900001 });
    await history().query(`SELECT setval('tp23.sf_log_history_id_seq', 500000)`);
    const a = await send(req('A', 'login'));
    const cdr = await send(req('CDR', 'login'));
    assert.deepEqual([a.outcome, cdr.outcome], ['stored', 'stored']);
    const { tp23, tp1 } = await allHistoryRows();
    const autoA = tp23.find((r) => r.set_code === 'A');
    assert.equal(String(autoA.id), '500001');
    assert.equal(tp1.find((r) => r.company_code === 'CDR').source, 'auto');
    assert.equal(await dedicatedHolds(autoA.id), true, 'the auto row id is recorded in the dedicated DB');
    assert.equal(await dedicatedHolds(viewerId), false, 'a viewer row id is not recorded as auto');
});

test('IH-06 행은 더하기만 한다 — 이미 있던 행은 그대로 남는다', async () => {
    await insertHistory('A', { useSe: 'DO6001', minutesAgo: 60 });
    await insertHistory('A', { useSe: 'DO6999', test: true, minutesAgo: 50 });
    await insertHistory('CDR', { useSe: 'DO6001', resultCode: 'AP1029', minutesAgo: 45 });
    await insertHistory('B', { useSe: 'DO6001', resultCode: null, error: 'x', minutesAgo: 44 });
    const before = await allHistoryRows();
    const send = await fn('step-sender', 'sendStep');
    await send(req('A', 'query'));
    await send(req('CDR', 'login'));
    await send(req('B', 'login'));
    const after = await allHistoryRows();
    for (const t of ['tp23', 'tp1']) {
        for (const row of before[t]) assert.deepEqual(after[t].find((r) => String(r.id) === String(row.id)), row, `${t} row ${row.id} unchanged`);
    }
    assert.ok(after.tp23.length + after.tp1.length > before.tp23.length + before.tp1.length, 'rows were added');
});
