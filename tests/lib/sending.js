// Shared set-up for gates that drive sendStep against the fake log API and the test history tables.
// sendStep runs on the real clock (no SF_DAILY_FAKE_NOW): history sent_at comes from the DB's now(),
// so "today" for the gates is the real KST date. Avoid running these gates across KST midnight.
import { before, after, beforeEach } from 'node:test';
import { applyBaseEnv } from './env.js';
import { startFakeInternet } from './fake-internet.js';
import { resetHistory, clearDedicated, insertHistory, closeDb, failHistoryWrites } from './db.js';
import { kstToday, MIN } from './kst.js';
import { useSeOf } from './roster.js';

/** Registers before/after hooks; returns a context whose .fake is the fake internet. */
export function useSendingWorld(envExtra = {}) {
    const ctx = { fake: null };
    applyBaseEnv(envExtra);
    before(async () => { ctx.fake = await startFakeInternet(); });
    after(async () => { await ctx.fake.stop(); await closeDb(); });
    beforeEach(async () => {
        await ctx.fake.start();
        ctx.fake.reset();
        await failHistoryWrites(false);
        await resetHistory();
        await clearDedicated();
    });
    return ctx;
}

export function req(company, step, { date = kstToday(), windowEnd = new Date(Date.now() + 60 * MIN) } = {}) {
    return { company, date, step, windowEnd };
}

const PREVIOUS = { login: [], query: ['login'], logout: ['login', 'query'] };

/** Earlier steps of `step` stored today by another writer, long enough ago to clear the 10-minute rule. */
export async function seedPrevious(code, step, minutesAgo = 25) {
    const start = new Date(Date.parse(`${kstToday()}T00:00:01+09:00`));
    let at = new Date(Math.max(Date.now() - minutesAgo * MIN, start.getTime()));
    for (const p of PREVIOUS[step]) {
        await insertHistory(code, { useSe: useSeOf(p), sentAt: at });
        at = new Date(at.getTime() + 1000);
    }
}
