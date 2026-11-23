// Gates for docs/spec/sf-daily/spec/business-day.md — see GATES.md in this folder.
import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseEnv } from '../../lib/env.js';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { startFakeInternet, startHttpCalendar } from '../../lib/fake-internet.js';
import { ical, holiday, memorial, newYears, DEFAULT_EVENTS } from '../../lib/ical.js';
import { kstAt } from '../../lib/kst.js';

applyBaseEnv();
let fake;
before(async () => { fake = await startFakeInternet(); });
after(async () => { await fake.stop(); });
beforeEach(async () => { await fake.start(); fake.reset(); });

const TUE = '2026-11-24'; // a plain weekday, no event in the default calendar
const SAT = '2026-11-28';
const SUN = '2026-11-29';
const calendarWith = (events) => () => ({ status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' }, body: ical(events) });

async function judge(date, hms = '12:00') {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    return judgeBusinessDay(kstAt(date, hms));
}

test('BD-01 그날은 판단 시점의 KST 날짜다 (UTC 15:00 이 다음 날의 시작)', async () => {
    const judgeBusinessDay = await fn('business-day', 'judgeBusinessDay');
    assert.equal((await judgeBusinessDay(new Date('2026-11-24T15:00:00.000Z'))).date, '2026-11-25');
    assert.equal((await judgeBusinessDay(new Date('2026-11-24T14:59:59.999Z'))).date, '2026-11-24');
    assert.equal((await judgeBusinessDay(new Date('2026-12-31T15:00:00.000Z'))).date, '2027-01-01');
});

test('BD-02 토요일은 쉬는 날, 사유 토요일', async () => {
    const r = await judge(SAT);
    assert.deepEqual([r.result, r.reason, r.holidayName], ['off', 'saturday', null]);
});

test('BD-03 일요일은 쉬는 날, 사유 일요일', async () => {
    const r = await judge(SUN);
    assert.deepEqual([r.result, r.reason, r.holidayName], ['off', 'sunday', null]);
});

test('BD-04 평일 5월 1일은 쉬는 날, 사유 5월 1일', async () => {
    const r = await judge('2026-05-01'); // Friday
    assert.deepEqual([r.result, r.reason, r.holidayName], ['off', 'may_first', null]);
});

test('BD-05 사유는 표의 순서로 먼저 맞는 하나다', async () => {
    fake.calendar.respond = calendarWith([...DEFAULT_EVENTS, holiday('2026-11-28', '토요일 공휴일'), holiday('2026-05-01', '5월 1일 공휴일'), holiday('2022-05-01', '일요일 공휴일')]);
    assert.equal((await judge('2027-05-01')).reason, 'saturday'); // May 1 on a Saturday
    assert.equal((await judge('2022-05-01')).reason, 'sunday'); // May 1 on a Sunday
    assert.equal((await judge('2026-11-28')).reason, 'saturday'); // 공휴일 on a Saturday
    assert.equal((await judge('2026-05-01')).reason, 'may_first'); // 공휴일 on a weekday May 1
});

test('BD-06 토요일 · 일요일 · 5월 1일은 달력 없이 판단한다', async () => {
    fake.calendar.respond = () => ({ status: 500, body: 'down' });
    assert.deepEqual([(await judge(SAT)).result, (await judge(SAT)).reason], ['off', 'saturday']);
    assert.deepEqual([(await judge('2026-05-01')).result, (await judge('2026-05-01')).reason], ['off', 'may_first']);
    await fake.stop();
    assert.deepEqual([(await judge(SUN)).result, (await judge(SUN)).reason], ['off', 'sunday']);
    assert.deepEqual([(await judge('2026-05-01')).result, (await judge('2026-05-01')).reason], ['off', 'may_first']);
});

test('BD-07 달력에 그날 설명이 「공휴일」 인 일정이 있으면 쉬는 날, 사유 공휴일과 그 일정 이름', async () => {
    const r = await judge('2026-05-05'); // Tuesday, 어린이날 공휴일
    assert.deepEqual([r.result, r.reason, r.holidayName], ['off', 'holiday', '어린이날']);
});

test('BD-08 설명이 「기념일」 인 일정의 평일은 영업일이다', async () => {
    for (const d of ['2026-05-08', '2026-12-24']) { // 어버이날 (Fri), 크리스마스 이브 (Thu)
        const r = await judge(d);
        assert.deepEqual([d, r.result, r.reason, r.holidayName], [d, 'business', null, null]);
    }
});

test('BD-09 대체공휴일 · 선거일 · 임시공휴일은 달력에 공휴일로 오르면 쉬는 날이다', async () => {
    fake.calendar.respond = calendarWith([...DEFAULT_EVENTS, holiday(TUE, '임시공휴일')]);
    const sub = await judge('2026-03-02');
    const elect = await judge('2026-06-03');
    const temp = await judge(TUE);
    assert.deepEqual([sub.result, sub.reason, sub.holidayName], ['off', 'holiday', '쉬는 날 삼일절']);
    assert.deepEqual([elect.result, elect.reason, elect.holidayName], ['off', 'holiday', '지방선거일']);
    assert.deepEqual([temp.result, temp.reason, temp.holidayName], ['off', 'holiday', '임시공휴일']);
});

test('BD-10 평일에 달력이 정상 응답이 아니거나 닿지 않으면 확인 불가, 사유 달력 받기 실패', async () => {
    fake.calendar.respond = () => ({ status: 500, body: 'oops' });
    const a = await judge(TUE);
    fake.calendar.respond = () => ({ status: 404, body: 'gone' });
    const b = await judge(TUE);
    await fake.stop();
    const c = await judge(TUE);
    for (const r of [a, b, c]) assert.deepEqual([r.result, r.reason, r.holidayName], ['unknown', 'calendar_fetch_failed', null]);
});

test('BD-11 달력 받기가 5초 안에 끝나지 않으면 달력 받기 실패다', { timeout: 30_000 }, async () => {
    fake.calendar.respond = () => ({ delayMs: 7000, status: 200, headers: { 'content-type': 'text/calendar' }, body: ical() });
    const r = await judge(TUE);
    assert.deepEqual([r.result, r.reason], ['unknown', 'calendar_fetch_failed']);
});

test('BD-12 5초 안에 끝난 달력 받기는 실패가 아니다', { timeout: 30_000 }, async () => {
    fake.calendar.respond = () => ({ delayMs: 3000, status: 200, headers: { 'content-type': 'text/calendar' }, body: ical() });
    const r = await judge(TUE);
    assert.deepEqual([r.result, r.reason], ['business', null]);
});

test('BD-13 달력 응답이 정한 모양이 아니면 확인 불가, 사유 달력 형식 오류', async () => {
    fake.calendar.respond = () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>maintenance</body></html>' });
    const a = await judge(TUE);
    fake.calendar.respond = () => ({ status: 200, headers: { 'content-type': 'text/calendar' }, body: 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nEND:VCALENDAR\r\n' });
    const b = await judge(TUE);
    for (const r of [a, b]) assert.deepEqual([r.result, r.reason, r.holidayName], ['unknown', 'calendar_format_error', null]);
});

test('BD-14 달력에 그해 1월 1일 「공휴일」 이 없으면 확인 불가, 사유 그해 자료 없음', async () => {
    fake.calendar.respond = calendarWith([...newYears(2025, 2027), holiday('2026-05-05', '어린이날')]);
    const a = await judge(TUE);
    fake.calendar.respond = calendarWith([...newYears(2025, 2027), memorial('2026-01-01', '새해'), holiday('2026-05-05', '어린이날')]);
    const b = await judge(TUE);
    for (const r of [a, b]) assert.deepEqual([r.result, r.reason, r.holidayName], ['unknown', 'year_missing', null]);
});

test('BD-15 평일이고 공휴일 일정이 없고 그해 자료가 있으면 영업일이다', async () => {
    const r = await judge(TUE);
    assert.deepEqual([r.date, r.result, r.reason, r.holidayName], [TUE, 'business', null, null]);
});

test('BD-16 판단마다 달력을 새로 받는다 — 달력에 오른 임시공휴일은 다음 판단부터 쉬는 날', async () => {
    const first = await judge(TUE);
    assert.equal(first.result, 'business');
    const fetchedAfterFirst = fake.calendar.requests.length;
    assert.ok(fetchedAfterFirst >= 1, 'first judgment fetched the calendar');
    fake.calendar.respond = calendarWith([...DEFAULT_EVENTS, holiday(TUE, '임시공휴일')]);
    const second = await judge(TUE);
    assert.deepEqual([second.result, second.reason, second.holidayName], ['off', 'holiday', '임시공휴일']);
    assert.ok(fake.calendar.requests.length > fetchedAfterFirst, 'second judgment fetched the calendar again');
});

test('BD-17 SF_HOLIDAY_CALENDAR_URL 이 있으면 그 주소에서 달력을 받는다', { timeout: 30_000 }, async () => {
    const cal = await startHttpCalendar(ical([...DEFAULT_EVENTS, holiday(TUE, '그 주소의 공휴일')]));
    try {
        const r = await callInChild('business-day', 'judgeBusinessDay', [kstAt(TUE, '12:00')], { env: { SF_HOLIDAY_CALENDAR_URL: cal.url } });
        assert.ok(r.ok, JSON.stringify(r.error));
        assert.deepEqual([r.value.result, r.value.reason, r.value.holidayName], ['off', 'holiday', '그 주소의 공휴일']);
        assert.ok(cal.endpoint.requests.length >= 1);
        assert.equal(cal.endpoint.requests[0].url, '/gate/holidays.ics');
        assert.equal(fake.calendar.requests.length, 0);
    } finally { await cal.close(); }
});
