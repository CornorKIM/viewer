// Gates for docs/spec/interfaces/kr-holiday-calendar.md (제품 밖 · 읽기 전용) — what our side must do
// against the calendar, via the stub. See GATES.md in this folder.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseEnv } from '../../lib/env.js';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { startFakeInternet, CAL_HOST, CAL_PATH } from '../../lib/fake-internet.js';
import { ical, holiday, memorial, DEFAULT_EVENTS } from '../../lib/ical.js';
import { kstAt } from '../../lib/kst.js';

applyBaseEnv();
let fake;
before(async () => { fake = await startFakeInternet(); });
after(async () => { await fake.stop(); });
beforeEach(async () => { await fake.start(); fake.reset(); });

const withEvents = (events, opts) => () => ({ status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' }, body: ical(events, opts) });

test('IC-01 BD-18 SF_HOLIDAY_CALENDAR_URL 이 비면 계약의 공개 iCal 주소를 키 없이 GET 한다', { timeout: 30_000 }, async () => {
    for (const env of [{ SF_HOLIDAY_CALENDAR_URL: null }, { SF_HOLIDAY_CALENDAR_URL: '' }]) {
        fake.reset();
        const r = await callInChild('business-day', 'judgeBusinessDay', [kstAt('2026-11-24', '12:00')], { env });
        assert.ok(r.ok, JSON.stringify(r.error));
        assert.equal(r.value.result, 'business');
        assert.ok(fake.calendar.requests.length >= 1, 'the default calendar URL was fetched');
        const q = fake.calendar.requests[0];
        assert.deepEqual([q.method, q.host, q.url], ['GET', CAL_HOST, CAL_PATH]);
    }
});

test('IC-02 접힌 속성 줄(CRLF + 공백)을 이어 읽는다', async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    const long = '아주 긴 이름의 임시공휴일 — 줄 접기를 넘어서는 일정 이름';
    fake.calendar.respond = withEvents([...DEFAULT_EVENTS, holiday('2026-11-24', long), memorial('2026-11-25', '기념일로 접힌 아주 긴 이름의 어떤 날짜 일정')], { foldLines: true });
    const r = await judgeBusinessDay(kstAt('2026-11-24', '12:00'));
    assert.deepEqual([r.result, r.reason, r.holidayName], ['off', 'holiday', long]);
    const m = await judgeBusinessDay(kstAt('2026-11-25', '12:00'));
    assert.equal(m.result, 'business');
});

test('IC-03 일정 날짜(DTSTART;VALUE=DATE)는 시간대 변환 없이 한국 날짜로 읽는다', async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    fake.calendar.respond = withEvents([...DEFAULT_EVENTS, holiday('2026-11-25', '수요일 공휴일')]);
    // 2026-11-25 00:30 KST is still 2026-11-24 in UTC.
    const early = await judgeBusinessDay(new Date('2026-11-24T15:30:00Z'));
    assert.deepEqual([early.date, early.result, early.holidayName], ['2026-11-25', 'off', '수요일 공휴일']);
    // 2026-11-24 23:30 KST — UTC date is the same day; the 25th's holiday must not leak back.
    const late = await judgeBusinessDay(new Date('2026-11-24T14:30:00Z'));
    assert.deepEqual([late.date, late.result], ['2026-11-24', 'business']);
});
