// Gates for docs/spec/sf-daily/api/business-day.md — see GATES.md in this folder.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseEnv } from '../../../lib/env.js';
import { fn } from '../../../lib/sut.js';
import { startFakeInternet } from '../../../lib/fake-internet.js';
import { kstAt } from '../../../lib/kst.js';

applyBaseEnv();
let fake;
before(async () => { fake = await startFakeInternet(); });
after(async () => { await fake.stop(); });
beforeEach(async () => { await fake.start(); fake.reset(); });

const REASONS = { saturday: 'off', sunday: 'off', may_first: 'off', holiday: 'off', calendar_fetch_failed: 'unknown', calendar_format_error: 'unknown', year_missing: 'unknown' };

function assertShape(r, at) {
    assert.deepEqual(Object.keys(r).filter((k) => ['date', 'result', 'reason', 'holidayName'].includes(k)).sort(), ['date', 'holidayName', 'reason', 'result']);
    assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
    assert.equal(r.date, new Date(at.getTime() + 9 * 3600_000).toISOString().slice(0, 10), 'date is the UTC+9 date of at');
    assert.ok(['business', 'off', 'unknown'].includes(r.result), `result ${r.result}`);
    if (r.result === 'business') { assert.equal(r.reason, null); assert.equal(r.holidayName, null); return; }
    assert.ok(r.reason in REASONS, `reason ${r.reason}`);
    assert.equal(REASONS[r.reason], r.result, 'reason belongs to its result');
    if (r.reason === 'holiday') assert.equal(typeof r.holidayName, 'string'); else assert.equal(r.holidayName, null);
}

test('ABD-01 돌려받는 값은 date · result · reason · holidayName 네 필드이고 사유 표와 null 규칙을 지킨다', async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    const cases = [['2026-11-24', '09:00'], ['2026-11-28', '09:00'], ['2026-05-01', '09:00'], ['2026-05-05', '09:00'], ['2026-11-24', '23:59']];
    for (const [d, t] of cases) { const at = kstAt(d, t); assertShape(await judgeBusinessDay(at), at); }
    fake.calendar.respond = () => ({ status: 503 });
    const at = kstAt('2026-11-24', '00:00');
    assertShape(await judgeBusinessDay(at), at);
});

test('ABD-02 at 이 유효한 Date 가 아니면 TypeError', async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    for (const bad of [new Date('not a date'), '2026-11-24', 1764000000000, undefined, null, {}]) {
        await assert.rejects(async () => judgeBusinessDay(bad), TypeError, `input ${String(bad)}`);
    }
});

test('ABD-03 달력 문제로 예외를 던지지 않는다 — 언제나 unknown 으로 돌아온다', { timeout: 30_000 }, async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    const at = kstAt('2026-11-24', '12:00');
    const problems = [
        () => ({ status: 500 }),
        () => ({ status: 200, body: 'garbage' }),
        () => ({ destroy: true }),
        () => ({ status: 200, body: 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nbroken' }),
    ];
    for (const p of problems) {
        fake.calendar.respond = p;
        const r = await judgeBusinessDay(at); // must resolve
        assert.equal(r.result, 'unknown');
    }
    await fake.stop();
    assert.equal((await judgeBusinessDay(at)).result, 'unknown');
});
