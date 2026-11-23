// iCalendar bodies shaped like Google's public "대한민국의 휴일" feed (interfaces/kr-holiday-calendar.md).
const HOLIDAY = '공휴일';
const MEMORIAL = '기념일\\n설정 > 공휴일에서 기념일을 숨길 수 있습니다.';

export const holiday = (date, summary) => ({ date, summary, description: HOLIDAY });
export const memorial = (date, summary) => ({ date, summary, description: MEMORIAL });

/** Jan 1 공휴일 of each year — the "그해 자료" marker. */
export const newYears = (...years) => years.map((y) => holiday(`${y}-01-01`, '새해'));

export const DEFAULT_EVENTS = [
    ...newYears(2024, 2025, 2026, 2027, 2028, 2029, 2030, 2031, 2032),
    holiday('2026-03-01', '삼일절'),
    holiday('2026-03-02', '쉬는 날 삼일절'),
    memorial('2026-04-05', '식목일'),
    holiday('2026-05-05', '어린이날'),
    memorial('2026-05-08', '어버이날'),
    holiday('2026-06-03', '지방선거일'),
    memorial('2026-12-24', '크리스마스 이브'),
    holiday('2026-12-25', '크리스마스'),
];

function fold(line, width = 30) {
    // iCalendar folding: CRLF + one space; fold on character boundaries.
    const chars = [...line];
    if (chars.length <= width) return line;
    const parts = [];
    for (let i = 0; i < chars.length; i += width) parts.push(chars.slice(i, i + width).join(''));
    return parts.join('\r\n ');
}

export function ical(events = DEFAULT_EVENTS, { foldLines = false } = {}) {
    const L = ['BEGIN:VCALENDAR', 'PRODID:-//Google Inc//Google Calendar 70.9054//EN', 'VERSION:2.0', 'CALSCALE:GREGORIAN',
        'METHOD:PUBLISH', 'X-WR-CALNAME:대한민국의 휴일', 'X-WR-TIMEZONE:UTC'];
    events.forEach((e, i) => {
        const ymd = e.date.replaceAll('-', '');
        const next = new Date(Date.UTC(+ymd.slice(0, 4), +ymd.slice(4, 6) - 1, +ymd.slice(6, 8) + 1));
        const nymd = next.toISOString().slice(0, 10).replaceAll('-', '');
        L.push('BEGIN:VEVENT', `DTSTART;VALUE=DATE:${ymd}`, `DTEND;VALUE=DATE:${nymd}`, 'DTSTAMP:20261101T000000Z',
            `UID:${ymd}_gate${i}@google.com`, 'CLASS:PUBLIC', `DESCRIPTION:${e.description}`, 'SEQUENCE:0', 'STATUS:CONFIRMED',
            `SUMMARY:${e.summary}`, 'TRANSP:TRANSPARENT', 'END:VEVENT');
    });
    L.push('END:VCALENDAR');
    return (foldLines ? L.map((l) => fold(l)) : L).join('\r\n') + '\r\n';
}
