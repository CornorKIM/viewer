// runner (docs/spec/sf-daily/spec/runner.md): one round (회차) at a time — on business days send the
// steps whose planned time has come, retry within the window, and send the status mail at SF_REPORT_AT.
import { kstDate, kstTime, kstAt } from './kst.js';
import { COMPANIES, STEPS, WINDOWS, companyOf } from './companies.js';

const DONE = new Set(['stored', 'already_stored', 'past_day', 'window_passed']);
const MAIL_DONE = new Set(['sent', 'already_sent']);
const MAIL_RETRY_MS = 5 * 60_000;
const QUERY_WINDOW_MS = 3 * 3600_000;
const UNKNOWN_REJUDGE_MS = 10 * 60_000;

/** Window end of a step for a company on a date, given that company's plan entry. */
export function windowEnd(date, code, step, planned) {
    const w = WINDOWS[companyOf(code).type];
    if (step === 'login') return kstAt(date, w.login[1]);
    if (step === 'query') return new Date(planned.login.getTime() + QUERY_WINDOW_MS);
    return kstAt(date, w.logout[1]);
}

export function createRunner(deps = {}) {
    const env = deps.env || process.env;
    const now = deps.now || (() => new Date());
    const log = deps.log || ((line) => process.stdout.write(`${line}\n`));
    const { judgeBusinessDay, getDailyPlan, sendStep, sendStatusMail } = deps;
    const stopRequested = deps.stopRequested || (() => false); // optional: no new request once the service is stopping
    const enabled = String(env.SF_DAILY_ENABLED ?? '').trim() === 'true';
    const reportAt = String(env.SF_REPORT_AT ?? '').trim() || '23:00';

    let day = null; // per-day state, see newDay()
    const stamp = (t) => `${kstDate(t)} ${kstTime(t)}`;
    const say = (t, msg) => log(`[sf-daily] ${stamp(t)} ${msg}`);

    const newDay = (date) => ({
        date,
        plan: null,
        done: new Set(), // 'code|step' that are not requested again today
        mailDone: false,
        mailTriedAt: null,
        judgment: null, // last judgment result of the day
        judgedAt: null,
        off: false, // an off judgment happened today
        fresh: false, // a judgment was taken in this round and no request followed it yet
        lastLogged: null,
    });

    /** At most one step per company: the first not-finished step whose time has come and whose window is open. */
    function dueSteps(t) {
        if (!day.plan) return [];
        const out = [];
        for (const c of COMPANIES) {
            const planned = day.plan.companies.find((x) => x.code === c.code);
            if (!planned) continue;
            for (const s of STEPS) {
                if (day.done.has(`${c.code}|${s.step}`)) continue;
                const end = windowEnd(day.date, c.code, s.step, planned);
                if (planned[s.step].getTime() <= t.getTime() && t.getTime() < end.getTime()) {
                    out.push({ company: c.code, date: day.date, step: s.step, windowEnd: end });
                    break;
                }
            }
        }
        return out;
    }

    function mailDue(t) {
        if (day.mailDone) return false;
        if (t.getTime() < kstAt(day.date, reportAt).getTime()) return false;
        return day.mailTriedAt === null || t.getTime() - day.mailTriedAt >= MAIL_RETRY_MS;
    }

    /** Takes a judgment now and records it for the day. Returns its result. */
    async function judge(t) {
        let j;
        try {
            j = await judgeBusinessDay(t);
        } catch (err) {
            j = { date: day.date, result: 'unknown', reason: `error ${String(err?.message ?? err)}`, holidayName: null };
        }
        day.judgment = j.result;
        day.judgedAt = t.getTime();
        day.fresh = true;
        if (j.result === 'off') day.off = true;
        const text = `${j.result}${j.reason ? ` ${j.reason}` : ''}${j.holidayName ? ` (${j.holidayName})` : ''}`;
        if (text !== day.lastLogged) { say(t, `영업일 판단 ${j.date}: ${text}`); day.lastLogged = text; }
        return j.result;
    }

    /** Right before a request: a fresh judgment (one taken earlier in this round with no request since counts). */
    async function businessRightBefore(t) {
        const ok = (day.fresh && day.judgment === 'business') || (await judge(t)) === 'business';
        day.fresh = false;
        return ok;
    }

    async function tick() {
        if (!enabled) return;
        const t = now();
        const date = kstDate(t);
        if (!day || day.date !== date) day = newDay(date);
        day.fresh = false;

        // runner §2-1: first round of the day judges; an off day is not judged again; unknown again after 10 minutes.
        if (day.off) return;
        if (day.judgment === null) {
            if ((await judge(t)) !== 'business') return;
        } else if (day.judgment === 'unknown') {
            if (t.getTime() - day.judgedAt < UNKNOWN_REJUDGE_MS) return;
            if ((await judge(t)) !== 'business') return;
        }

        if (!day.plan) {
            try {
                day.plan = await getDailyPlan(date);
                say(t, `하루 계획 ${date}: ${day.plan.companies.map((c) => `${c.code} ${kstTime(c.login)}/${kstTime(c.query)}/${kstTime(c.logout)}`).join(', ')}`);
            } catch (err) {
                say(t, `하루 계획 오류: ${String(err?.message ?? err)}`);
                return;
            }
        }

        for (const req of dueSteps(t)) {
            if (stopRequested() || !(await businessRightBefore(t))) return;
            let r;
            try {
                r = await sendStep(req);
            } catch (err) {
                say(t, `보내기 ${req.company} ${req.step}: 오류 ${String(err?.message ?? err)}`);
                continue;
            }
            if (DONE.has(r.outcome)) day.done.add(`${req.company}|${req.step}`);
            say(t, `보내기 ${req.company} ${req.step}: ${r.outcome}${r.resultCode ? ` ${r.resultCode}` : ''}${r.message ? ` ${r.message}` : ''}`);
        }

        if (mailDue(t)) {
            if (stopRequested() || !(await businessRightBefore(t))) return;
            let r;
            try {
                r = await sendStatusMail(date);
            } catch (err) {
                r = { outcome: 'failed', missingLogin: [], error: String(err?.message ?? err) };
            }
            if (MAIL_DONE.has(r.outcome)) day.mailDone = true; else day.mailTriedAt = t.getTime();
            const missing = r.missingLogin?.length ? ` 로그인 누락 ${r.missingLogin.join(',')}` : '';
            say(t, `현황 메일 ${date}: ${r.outcome}${missing}${r.error ? ` ${r.error}` : ''}`);
        }
    }

    return { tick };
}
