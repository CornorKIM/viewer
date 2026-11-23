// KST helpers computed from UTC arithmetic only (KST = UTC+9, no DST) — never from the process TZ.
const H = 3600_000;
export const MIN = 60_000;
export const pad = (n, w = 2) => String(n).padStart(w, '0');

function shifted(d) { return new Date(d.getTime() + 9 * H); }

/** 'YYYY-MM-DD' of the KST calendar date of instant d. */
export function kstDate(d = new Date()) {
    const t = shifted(d);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 'HH:MM:SS' KST wall clock of instant d. */
export function kstTime(d) {
    const t = shifted(d);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** 'YYYY-MM-DD HH:MI:SS.SSS' KST (log date format of the log API). */
export function kstLogDt(d) {
    const t = shifted(d);
    return `${kstDate(d)} ${kstTime(d)}.${pad(t.getUTCMilliseconds(), 3)}`;
}

/** Instant of KST wall clock `hms` ('HH:MM' or 'HH:MM:SS') on KST date `date`. */
export function kstAt(date, hms = '00:00:00') {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mi, ss = 0] = hms.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mi, ss) - 9 * H);
}

export function addDays(date, n) {
    const t = kstAt(date, '12:00');
    return kstDate(new Date(t.getTime() + n * 24 * H));
}

/** 0 = Sunday … 6 = Saturday, of a KST date string. */
export function weekday(date) { return kstAt(date, '12:00').getUTCDay(); }

/** First KST date on or after `date` with the given weekday. */
export function nextWeekday(date, dow) {
    let d = date;
    while (weekday(d) !== dow) d = addDays(d, 1);
    return d;
}

export const kstToday = () => kstDate(new Date());
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
