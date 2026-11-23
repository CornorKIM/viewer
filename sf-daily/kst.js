// KST (UTC+9, no DST) arithmetic, independent of the process time zone.
const H = 3600_000;
const pad = (n, w = 2) => String(n).padStart(w, '0');
const shifted = (d) => new Date(d.getTime() + 9 * H);

/** 'YYYY-MM-DD' KST date of instant d. */
export function kstDate(d) {
    const t = shifted(d);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 'HH:MM:SS' KST wall clock of instant d. */
export function kstTime(d) {
    const t = shifted(d);
    return `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}`;
}

/** 'YYYY-MM-DD HH:MI:SS.SSS' KST — the log API's log date format. */
export function kstLogDt(d) {
    return `${kstDate(d)} ${kstTime(d)}.${pad(shifted(d).getUTCMilliseconds(), 3)}`;
}

/** Instant of KST wall clock 'HH:MM[:SS]' on KST date 'YYYY-MM-DD'. */
export function kstAt(date, hms = '00:00:00') {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mi, ss = 0] = hms.split(':').map(Number);
    return new Date(Date.UTC(y, m - 1, d, hh, mi, ss) - 9 * H);
}

/** 0 = Sunday … 6 = Saturday of a KST date string. */
export function weekday(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** Is v a 'YYYY-MM-DD' string naming a real calendar date? */
export function isDateString(v) {
    if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    const [y, m, d] = v.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export function assertDateString(v, what = 'date') {
    if (!isDateString(v)) throw new TypeError(`${what} 는 YYYY-MM-DD 형식의 있는 날짜여야 한다`);
}
