import { timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import { Client } from 'pg';
import { PG_CONFIG, kstLogDt } from './_sf-send.js';
import { checkScheduledDay } from './_kr-holiday.js';
import { insertTp1History, sendTp1Log, tp1Key } from './_tp1.js';

const COMPANY = 'CDR';
const STEPS = [
    { code: 'DO6001', start: '08:00:00', end: '10:00:00' },
    { code: 'DO6003', start: '10:00:00', end: '16:00:00' },
    { code: 'DO6004', start: '16:00:00', end: '17:00:00' },
    { code: 'DO6002', start: '17:00:00', end: '19:00:00' },
];

const ENSURE_STATE = `CREATE TABLE IF NOT EXISTS tp1.sf_auto_log_state (
    day date NOT NULL,
    company_code varchar(10) NOT NULL,
    use_se varchar(10) NOT NULL,
    claimed_at timestamptz NOT NULL DEFAULT now(),
    accepted boolean NOT NULL DEFAULT false,
    result_code varchar(10),
    PRIMARY KEY (day, company_code, use_se)
)`;

const CLAIM = `INSERT INTO tp1.sf_auto_log_state (day, company_code, use_se)
    SELECT $1::date, $2, $3
    WHERE $4::text IS NULL OR EXISTS (
        SELECT 1 FROM tp1.sf_auto_log_state
        WHERE day = $1::date AND company_code = $2 AND use_se = $4 AND accepted
    )
    ON CONFLICT DO NOTHING`;

function authorized(header) {
    const secret = process.env.CDR_INGEST_SECRET;
    if (!secret || typeof header !== 'string') return false;
    const actual = Buffer.from(header);
    const expected = Buffer.from(`Bearer ${secret}`);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export default async function handler(req, res) {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
    if (!authorized(req.headers.authorization)) return res.status(401).json({ error: 'unauthorized' });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { return res.status(400).json({ error: 'invalid_json' }); }
    }
    const index = STEPS.findIndex(({ code }) => code === body?.useSe);
    if (index === -1) return res.status(400).json({ error: 'unknown_use_se' });
    const { code, start, end } = STEPS[index];
    const now = new Date();
    const time = kstLogDt(now).slice(11, 19);
    if (time < start || time >= end) return res.status(200).json({ skipped: 'outside_window', useSe: code });

    let calendar;
    try {
        calendar = await checkScheduledDay({ now });
    } catch {
        return res.status(503).json({ error: 'holiday_verification_failed' });
    }
    if (!calendar.allowed) return res.status(200).json({ skipped: calendar.reason, date: calendar.date });

    const ip = String(req.headers['x-vercel-forwarded-for'] ?? '').trim().replace(/^::ffff:/i, '');
    if (ip.length > 30 || !isIP(ip)) return res.status(503).json({ error: 'connection_ip_unavailable' });
    if (!process.env.PG_PASSWORD || !tp1Key(COMPANY)) {
        return res.status(503).json({ error: 'missing_viewer_configuration' });
    }

    const db = new Client({ ...PG_CONFIG, statement_timeout: 3_000 });
    try {
        await db.connect();
        await db.query('CREATE SCHEMA IF NOT EXISTS tp1');
        await db.query(ENSURE_STATE);
        const deadline = Date.parse(`${calendar.date}T${end}+09:00`) - 30_000;
        if (Date.now() >= deadline) return res.status(200).json({ skipped: 'window_closing' });

        const args = [calendar.date, COMPANY, code];
        const claim = await db.query(CLAIM, [...args, STEPS[index - 1]?.code ?? null]);
        if (!claim.rowCount) {
            return res.status(200).json({ skipped: 'already_claimed_or_previous_unconfirmed', useSe: code });
        }
        if (Date.now() >= deadline) {
            await db.query('DELETE FROM tp1.sf_auto_log_state WHERE day = $1 AND company_code = $2 AND use_se = $3', args);
            return res.status(200).json({ skipped: 'window_closing' });
        }

        const sent = await sendTp1Log(COMPANY, { useSe: code, test: false, conectIp: ip, dataUsgqty: 0 });
        const status = sent.response?.http;
        const raw = sent.response?.code;
        const result = /^AP\d{4}$/.test(raw) ? raw : null;
        const accepted = !sent.error && status >= 200 && status < 300 && result === 'AP1002';
        await db.query(
            `UPDATE tp1.sf_auto_log_state SET accepted = $4, result_code = $5
             WHERE day = $1 AND company_code = $2 AND use_se = $3`,
            [...args, accepted, result],
        );
        try {
            await insertTp1History(db, {
                code: COMPANY, source: 'auto', test: false, fields: sent.fields,
                response: sent.response, error: sent.error,
            });
        } catch {
            console.error('CDR scheduled history could not be saved', code);
        }
        return res.status(accepted ? 200 : 502).json({ accepted, useSe: code, result });
    } catch {
        return res.status(503).json({ error: 'scheduled_delivery_unconfirmed', useSe: code });
    } finally {
        await db.end().catch(() => {});
    }
}
