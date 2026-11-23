// The service settings table of docs/spec/sf-daily/spec/runner.md and its start-refusal conditions.
import { missingKeys } from './companies.js';
import { recipients } from './status-mail.js';

const blank = (v) => v === undefined || v === null || String(v).trim() === '';
const val = (env, k, dflt) => (blank(env[k]) ? dflt : String(env[k]).trim());

const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@,<>]+@[^\s@,<>]+\.[^\s@,<>]+$/;

/** A postgres:// URL whose password part is empty (e.g. composed from an unset SF_DB_PASSWORD) can never connect. */
function dbUrlPasswordEmpty(url) {
    let u;
    try { u = new URL(url); } catch { return false; }
    if (!/^postgres(ql)?:$/.test(u.protocol)) return false;
    return u.password === '';
}

/** → { ok, problems: [{ name, why }], settings } — never echoes a secret value. */
export function checkSettings(env = process.env) {
    const problems = [];
    const bad = (name, why) => problems.push({ name, why });

    const enabledRaw = val(env, 'SF_DAILY_ENABLED', 'false');
    if (enabledRaw !== 'true' && enabledRaw !== 'false') bad('SF_DAILY_ENABLED', 'true 또는 false 여야 한다');
    const enabled = enabledRaw === 'true';

    const tickRaw = val(env, 'SF_DAILY_TICK_SECONDS', '30');
    const tick = /^\d+$/.test(tickRaw) ? Number(tickRaw) : NaN;
    if (!(tick >= 10 && tick <= 60)) bad('SF_DAILY_TICK_SECONDS', '10 이상 60 이하의 정수여야 한다');

    const reportAt = val(env, 'SF_REPORT_AT', '23:00');
    if (!HHMM.test(reportAt)) bad('SF_REPORT_AT', 'HH:MM 이어야 한다');

    if (enabled) for (const k of missingKeys(env)) bad(k, '비어 있다');

    if (enabled && !blank(env.SF_DAILY_FAKE_NOW)) bad('SF_DAILY_FAKE_NOW', '켜진 서비스에서는 시험용 시계를 쓸 수 없다');

    if (blank(env.SF_DB_URL)) bad('SF_DB_URL', '비어 있다');
    else if (dbUrlPasswordEmpty(String(env.SF_DB_URL).trim())) bad('SF_DB_URL', '비밀번호 부분이 비어 있다(SF_DB_PASSWORD 확인)');
    if (blank(env.PG_PASSWORD)) bad('PG_PASSWORD', '비어 있다');

    if (enabled) {
        for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SF_REPORT_TO']) if (blank(env[k])) bad(k, '비어 있다');
        if (!blank(env.SF_REPORT_TO)) {
            const list = recipients(env.SF_REPORT_TO);
            if (!list.length || list.some((a) => !EMAIL.test(a)) || String(env.SF_REPORT_TO).split(',').some((s) => !s.trim())) {
                bad('SF_REPORT_TO', '쉼표로 나눈 메일 주소여야 한다');
            }
        }
    }

    const ip = val(env, 'SF_LOG_DEFAULT_IP', '175.193.55.102');
    if (!IPV4.test(ip)) bad('SF_LOG_DEFAULT_IP', 'IPv4 모양이어야 한다');

    return { ok: problems.length === 0, problems, settings: { enabled, tickSeconds: tick, reportAt } };
}
