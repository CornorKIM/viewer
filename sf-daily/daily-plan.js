// daily-plan (docs/spec/sf-daily/spec/daily-plan.md · api/daily-plan.md):
// per company and day, the three planned send times — drawn once, kept in the dedicated DB for good.
import { randomInt } from 'node:crypto';
import { assertDateString, kstAt } from './kst.js';
import { COMPANIES, WINDOWS, QUERY_OFFSET_MIN } from './companies.js';
import { inDedicatedTx, LOCK, dbError } from './db.js';

const MIN = 60_000;

/** Uniform whole-second instant in [start, end). */
function uniform(start, end) {
    const span = Math.floor((end - start) / 1000);
    return new Date(start + randomInt(0, span) * 1000);
}

/** Draws the plan for the companies not yet planned, keeping every login minute of the day distinct. */
function draw(date, companies, takenMinutes) {
    const minutes = new Set(takenMinutes);
    return companies.map((c) => {
        const w = WINDOWS[c.type];
        let login;
        do {
            login = uniform(+kstAt(date, w.login[0]), +kstAt(date, w.login[1]));
        } while (minutes.has(Math.floor(+login / MIN)));
        minutes.add(Math.floor(+login / MIN));
        const query = uniform(+login + QUERY_OFFSET_MIN[0] * MIN, +login + QUERY_OFFSET_MIN[1] * MIN);
        const logout = uniform(+kstAt(date, w.logout[0]), +kstAt(date, w.logout[1]));
        return { code: c.code, login, query, logout };
    });
}

const shape = (date, rows) => ({
    date,
    companies: COMPANIES.map((c) => {
        const r = rows.find((x) => x.company === c.code);
        return { code: c.code, login: new Date(r.login_at), query: new Date(r.query_at), logout: new Date(r.logout_at) };
    }),
});

/** getDailyPlan('YYYY-MM-DD') → { date, companies: [{ code, login, query, logout }] } */
export async function getDailyPlan(date) {
    assertDateString(date);
    try {
        return await inDedicatedTx(async (c) => {
            // One planner per date at a time: concurrent first calls see the plan the first one drew.
            await c.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK.plan, date]);
            const sel = () => c.query('SELECT company, login_at, query_at, logout_at FROM sf_daily_plan WHERE plan_date = $1', [date]);
            let rows = (await sel()).rows;
            const missing = COMPANIES.filter((co) => !rows.some((r) => r.company === co.code));
            if (missing.length) {
                const taken = rows.map((r) => Math.floor(+new Date(r.login_at) / MIN));
                for (const p of draw(date, missing, taken)) {
                    await c.query(
                        'INSERT INTO sf_daily_plan (plan_date, company, login_at, query_at, logout_at) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
                        [date, p.code, p.login, p.query, p.logout],
                    );
                }
                rows = (await sel()).rows;
            }
            return shape(date, rows);
        });
    } catch (err) { throw dbError(err); }
}
