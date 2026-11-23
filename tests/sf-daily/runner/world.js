// Thin adapter for the runner gates: drives createRunner(deps) tick by tick on a fake clock with
// fake seam functions, and records every call (see tests/lib/README.md, "runner").
import { fn } from '../../lib/sut.js';
import { kstAt, kstDate, weekday, MIN } from '../../lib/kst.js';
import { CODES } from '../../lib/roster.js';

/** A fixed plan for any date: { code: [login, query, logout] } as KST 'HH:MM:SS'. */
export const PLAN = {
    A: ['10:30:10', '11:30:00', '18:00:00'],
    B: ['10:40:00', '12:00:00', '18:30:00'],
    C: ['10:50:00', '12:30:00', '19:00:00'],
    D: ['11:00:00', '13:00:00', '19:30:00'],
    CDR: ['10:10:00', '11:00:00', '17:30:00'],
};

export function planFor(date, times = PLAN) {
    return { date, companies: CODES.map((code) => ({ code, login: kstAt(date, times[code][0]), query: kstAt(date, times[code][1]), logout: kstAt(date, times[code][2]) })) };
}

/** Default judgment: Saturday/Sunday off, every other day a business day. */
export function weekendJudge(at) {
    const date = kstDate(at);
    const dow = weekday(date);
    if (dow === 6) return { date, result: 'off', reason: 'saturday', holidayName: null };
    if (dow === 0) return { date, result: 'off', reason: 'sunday', holidayName: null };
    return { date, result: 'business', reason: null, holidayName: null };
}

/**
 * opts:
 *   env          settings object handed to createRunner (SF_DAILY_ENABLED defaults to 'true')
 *   judge(at)    → judgment (default weekendJudge)
 *   plan(date)   → plan (default planFor(date))
 *   step(req, now) → outcome string (default 'stored')
 *   mail(date, now) → outcome string (default 'sent')
 */
export async function makeRunner(opts = {}) {
    const createRunner = await fn('runner', 'createRunner');
    const calls = [];
    const logs = [];
    let nowMs = 0;
    let tick = 0;
    const judge = opts.judge || weekendJudge;
    const plan = opts.plan || ((date) => planFor(date));
    const step = opts.step || (() => 'stored');
    const mail = opts.mail || (() => 'sent');
    const runner = createRunner({
        now: () => new Date(nowMs),
        env: { SF_DAILY_ENABLED: 'true', ...(opts.env || {}) },
        judgeBusinessDay: async (at) => { calls.push({ kind: 'judge', tick, now: nowMs, at: new Date(at) }); return judge(new Date(at)); },
        getDailyPlan: async (date) => { calls.push({ kind: 'plan', tick, now: nowMs, date }); return plan(date); },
        sendStep: async (request) => {
            calls.push({ kind: 'step', tick, now: nowMs, ...request, windowEnd: new Date(request.windowEnd) });
            return { outcome: step(request, nowMs), resultCode: null, message: null };
        },
        sendStatusMail: async (date) => {
            calls.push({ kind: 'mail', tick, now: nowMs, date });
            const outcome = mail(date, nowMs);
            return { outcome, missingLogin: [], error: outcome === 'failed' ? 'stub failure' : null };
        },
        log: (line) => { logs.push({ tick, line: String(line) }); },
    });
    const w = {
        calls,
        logs,
        get tick() { return tick; },
        async at(instant) { tick++; nowMs = +instant; await runner.tick(); },
        /** Ticks from `from` to `to` inclusive every `everySec` seconds (instants). */
        async run(from, to, everySec = 30) { for (let t = +from; t <= +to; t += everySec * 1000) await w.at(new Date(t)); },
        steps(filter = {}) { return calls.filter((c) => c.kind === 'step' && Object.entries(filter).every(([k, v]) => c[k] === v)); },
        mails() { return calls.filter((c) => c.kind === 'mail'); },
        inTick(n) { return calls.filter((c) => c.tick === n); },
    };
    return w;
}

export { kstAt, MIN };
