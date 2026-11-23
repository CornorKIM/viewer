// Connections: the shared history DB (PG_HOST · PG_PASSWORD, as api/_sf-send.js PG_CONFIG) and the
// sf-daily dedicated DB (SF_DB_URL). The dedicated tables are created here on first use.
import pg from 'pg';
import { DB_HOST } from '../api/_sf-send.js';

const pools = new Map();
// Test-binding knob (tests/lib/README.md): SF_DB_QUERY_TIMEOUT_MS overrides the 30 s default.
const QUERY_TIMEOUT_MS = (() => {
    const v = Number.parseInt(process.env.SF_DB_QUERY_TIMEOUT_MS ?? '', 10);
    return Number.isInteger(v) && v >= 1000 ? v : 30_000;
})();

function pool(key, config) {
    let p = pools.get(key);
    if (!p) {
        p = new pg.Pool({
            max: 5,
            idleTimeoutMillis: 10_000,
            connectionTimeoutMillis: 10_000,
            allowExitOnIdle: true,
            keepAlive: true,
            statement_timeout: QUERY_TIMEOUT_MS, // server side, includes lock waits
            query_timeout: QUERY_TIMEOUT_MS + 5_000, // client side, in case the server never answers
            ...config,
        });
        p.on('error', () => {}); // an idle client dropped by the server must not crash the service
        // A checked-out client whose connection drops emits 'error' on itself; without a listener that crashes the process.
        p.on('connect', (client) => client.on('error', () => {}));
        pools.set(key, p);
    }
    return p;
}

/** A DB failure is always a plain Error (never the caller-defect TypeError). */
export function dbError(err) {
    if (err instanceof Error && !(err instanceof TypeError)) return err;
    const e = new Error(`DB 오류: ${String(err?.message ?? err)}`);
    e.cause = err;
    return e;
}

export function historyPool() {
    const host = String(process.env.PG_HOST ?? '').trim() || DB_HOST;
    const password = process.env.PG_PASSWORD ?? '';
    return pool(`history|${host}|${password}`, { host, port: 5432, database: 'postgres', user: 'postgres', password, ssl: false });
}

function dedicatedPool() {
    const url = String(process.env.SF_DB_URL ?? '').trim();
    if (!url) throw new Error('SF_DB_URL 이 비어 있다');
    return pool(`dedicated|${url}`, { connectionString: url });
}

// Advisory-lock namespaces (first key of the two-int form).
export const LOCK = { schema: 7301, plan: 7302, step: 7303, mail: 7304 };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sf_daily_plan (
    plan_date    text        NOT NULL,
    company      text        NOT NULL,
    login_at     timestamptz NOT NULL,
    query_at     timestamptz NOT NULL,
    logout_at    timestamptz NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (plan_date, company)
);
-- Send journal (step-sender §5): one entry per auto-send request, written before the request.
-- outcome NULL = sent, result never written. history_state: pending · recorded · unrecorded.
-- history_id of a recorded entry is also the auto-send mark of a tp23 row (sf-log-history).
CREATE TABLE IF NOT EXISTS sf_daily_send_journal (
    entry_id      text        PRIMARY KEY,
    company       text        NOT NULL,
    send_date     text        NOT NULL,
    step          text        NOT NULL,
    use_se        text        NOT NULL,
    requested_at  timestamptz NOT NULL DEFAULT now(),
    log_dt        text        NOT NULL,
    sys_user      text        NOT NULL,
    conect_ip     text        NOT NULL,
    outcome       text,
    result_code   text,
    http_status   text,
    result_msg    text,
    result_detail text,
    recptn_dt     text,
    error         text,
    history_state text        NOT NULL DEFAULT 'pending',
    history_table text,
    history_id    bigint
);
CREATE INDEX IF NOT EXISTS sf_daily_send_journal_day_idx ON sf_daily_send_journal (company, send_date, step);
CREATE INDEX IF NOT EXISTS sf_daily_send_journal_req_idx ON sf_daily_send_journal (company, requested_at DESC);
CREATE TABLE IF NOT EXISTS sf_daily_mail (
    mail_date    text        PRIMARY KEY,
    sent_at      timestamptz NOT NULL DEFAULT now()
);
`;

const ready = new WeakMap();

async function ensureSchema(p) {
    if (!ready.has(p)) {
        const job = (async () => {
            const c = await p.connect();
            try {
                await c.query('BEGIN');
                await c.query('SELECT pg_advisory_xact_lock($1, 0)', [LOCK.schema]);
                await c.query(SCHEMA);
                await c.query('COMMIT');
            } catch (err) {
                await c.query('ROLLBACK').catch(() => {});
                throw err;
            } finally { c.release(); }
        })();
        ready.set(p, job);
        job.catch(() => ready.delete(p));
    }
    return ready.get(p);
}

/** A dedicated-DB client with the schema in place. Release it when done. */
export async function dedicatedClient() {
    try {
        const p = dedicatedPool();
        await ensureSchema(p);
        return await p.connect();
    } catch (err) { throw dbError(err); }
}

/** Runs fn(client) inside one dedicated-DB transaction. */
export async function inDedicatedTx(fn) {
    const c = await dedicatedClient();
    try {
        await c.query('BEGIN');
        const out = await fn(c);
        await c.query('COMMIT');
        return out;
    } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        throw err;
    } finally { c.release(); }
}

export async function historyQuery(sql, params) {
    try { return await historyPool().query(sql, params); } catch (err) { throw dbError(err); }
}

export async function dedicatedQuery(sql, params) {
    const c = await dedicatedClient();
    try { return await c.query(sql, params); } catch (err) { throw dbError(err); } finally { c.release(); }
}
