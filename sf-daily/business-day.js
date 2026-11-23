// business-day (docs/spec/sf-daily/spec/business-day.md · api/business-day.md):
// is the KST date of a moment a business day? Calendar trouble always answers "unknown", never throws.
import { kstDate, weekday } from './kst.js';

export const DEFAULT_CALENDAR_URL = 'https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';
const FETCH_TIMEOUT_MS = 5000;

const calendarUrl = () => String(process.env.SF_HOLIDAY_CALENDAR_URL ?? '').trim() || DEFAULT_CALENDAR_URL;

const judgment = (date, result, reason = null, holidayName = null) => ({ date, result, reason, holidayName });

class CalendarError extends Error {
    constructor(reason, message) { super(message); this.reason = reason; }
}

async function fetchCalendar() {
    try {
        const r = await fetch(calendarUrl(), { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
        if (r.status !== 200) throw new CalendarError('calendar_fetch_failed', `HTTP ${r.status}`);
        return await r.text();
    } catch (err) {
        if (err instanceof CalendarError) throw err;
        throw new CalendarError('calendar_fetch_failed', String(err?.message ?? err));
    }
}

const unescapeText = (s) => s.replace(/\\([nN,;\\])/g, (_, c) => (c === 'n' || c === 'N' ? '\n' : c));

/** Parses the iCalendar body into [{ date: 'YYYY-MM-DD', summary, description }]. */
export function parseCalendar(text) {
    const body = String(text).replace(/^﻿/, '').replace(/^\s+/, '');
    if (!body.startsWith('BEGIN:VCALENDAR')) throw new CalendarError('calendar_format_error', 'no BEGIN:VCALENDAR');
    const lines = body.replace(/\r?\n[ \t]/g, '').split(/\r?\n/);
    const events = [];
    let cur = null;
    for (const line of lines) {
        if (line === 'BEGIN:VEVENT') { cur = {}; continue; }
        if (line === 'END:VEVENT') {
            if (cur && cur.date) events.push({ date: cur.date, summary: cur.summary ?? '', description: cur.description ?? '' });
            cur = null;
            continue;
        }
        if (!cur) continue;
        const i = line.indexOf(':');
        if (i <= 0) continue;
        const name = line.slice(0, i).split(';')[0].toUpperCase();
        const value = line.slice(i + 1);
        if (name === 'DTSTART') {
            const m = value.match(/^(\d{4})(\d{2})(\d{2})/);
            if (m) cur.date = `${m[1]}-${m[2]}-${m[3]}`;
        } else if (name === 'SUMMARY') cur.summary = unescapeText(value).trim();
        else if (name === 'DESCRIPTION') cur.description = unescapeText(value).trim();
    }
    if (events.length === 0) throw new CalendarError('calendar_format_error', 'no VEVENT');
    return events;
}

const isPublicHoliday = (e) => e.description === '공휴일';

/** judgeBusinessDay(at: Date) → { date, result: business|off|unknown, reason, holidayName } */
export async function judgeBusinessDay(at) {
    if (!(at instanceof Date) || Number.isNaN(at.getTime())) throw new TypeError('at 은 유효한 Date 여야 한다');
    const date = kstDate(at);
    const dow = weekday(date);
    if (dow === 6) return judgment(date, 'off', 'saturday');
    if (dow === 0) return judgment(date, 'off', 'sunday');
    if (date.slice(5) === '05-01') return judgment(date, 'off', 'may_first');
    let events;
    try {
        events = parseCalendar(await fetchCalendar());
    } catch (err) {
        return judgment(date, 'unknown', err instanceof CalendarError ? err.reason : 'calendar_format_error');
    }
    const year = date.slice(0, 4);
    if (!events.some((e) => e.date === `${year}-01-01` && isPublicHoliday(e))) return judgment(date, 'unknown', 'year_missing');
    const hit = events.find((e) => e.date === date && isPublicHoliday(e));
    if (hit) return judgment(date, 'off', 'holiday', hit.summary);
    return judgment(date, 'business');
}
