// The throwaway sfdaily-test PostgreSQL: the copied history tables (database "postgres", as the
// existing PG_CONFIG uses) and the sf-daily dedicated DB (SF_DB_URL, database "sfdaily").
import pg from 'pg';
import { byCode } from './roster.js';
import { kstLogDt } from './kst.js';

let historyPool = null;
let dedicatedPool = null;

export function history() {
    historyPool ||= new pg.Pool({ host: process.env.PG_HOST, port: 5432, database: 'postgres', user: 'postgres', password: process.env.PG_PASSWORD, max: 3 });
    return historyPool;
}
export function dedicated() {
    dedicatedPool ||= new pg.Pool({ connectionString: process.env.SF_DB_URL, max: 2 });
    return dedicatedPool;
}
export async function closeDb() {
    await Promise.all([historyPool?.end(), dedicatedPool?.end()]);
    historyPool = null; dedicatedPool = null;
}

/** Empties both history tables (ids restart at 1). */
export async function resetHistory() {
    await history().query('TRUNCATE tp23.sf_log_history, tp1.sf_log_history RESTART IDENTITY');
}

/** Empties every user table of the dedicated DB, whatever the implementation named them. */
export async function clearDedicated() {
    const { rows } = await dedicated().query(`SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
    if (rows.length) await dedicated().query(`TRUNCATE ${rows.map((r) => r.t).join(', ')} RESTART IDENTITY CASCADE`);
}

/** Number of rows across every user table of the dedicated DB. */
export async function dedicatedRowCount() {
    const { rows } = await dedicated().query(`SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema')`);
    let n = 0;
    for (const r of rows) n += Number((await dedicated().query(`SELECT count(*)::int AS n FROM ${r.t}`)).rows[0].n);
    return n;
}

/** Does any integer / numeric / text column of any dedicated-DB table hold exactly this value? */
export async function dedicatedHolds(value) {
    const { rows } = await dedicated().query(`SELECT table_schema, table_name, column_name FROM information_schema.columns
        WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
          AND data_type IN ('bigint', 'integer', 'smallint', 'numeric', 'text', 'character varying')`);
    for (const c of rows) {
        const q = `SELECT 1 FROM ${pg.escapeIdentifier(c.table_schema)}.${pg.escapeIdentifier(c.table_name)} WHERE ${pg.escapeIdentifier(c.column_name)}::text = $1 LIMIT 1`;
        if ((await dedicated().query(q, [String(value)])).rowCount) return true;
    }
    return false;
}

/**
 * Adds a history row as another writer (viewer screen, Vercel) or as a past request would.
 * opts: { useSe, resultCode = 'AP1002', test = false, sentAt (Date) | minutesAgo, source = 'login', id }
 * Returns the new row id.
 */
export async function insertHistory(code, { useSe, resultCode = 'AP1002', test = false, sentAt = null, minutesAgo = 30, source = 'login', id = null, error = null } = {}) {
    const c = byCode(code);
    const at = sentAt ?? new Date(Date.now() - minutesAgo * 60_000);
    const common = [test, useSe, kstLogDt(at), c.sysUser, '1.1.1.1', 0, resultCode ? 200 : null, resultCode, resultCode ? '시험 행' : null, null, null, error, at];
    if (c.table.startsWith('tp23')) {
        const cols = `${id ? 'id, ' : ''}set_code, equipment_no, test, use_se, log_dt, sys_user, conect_ip, data_usgqty, http_status, result_code, result_msg, result_detail, recptn_dt, error, sent_at`;
        const vals = [...(id ? [id] : []), code, c.equipmentNo, ...common];
        const ph = vals.map((_, i) => `$${i + 1}`).join(',');
        return (await history().query(`INSERT INTO tp23.sf_log_history (${cols}) VALUES (${ph}) RETURNING id`, vals)).rows[0].id;
    }
    const cols = `${id ? 'id, ' : ''}company_code, source, test, use_se, log_dt, sys_user, conect_ip, data_usgqty, http_status, result_code, result_msg, result_detail, recptn_dt, error, sent_at`;
    const vals = [...(id ? [id] : []), code, source, ...common];
    const ph = vals.map((_, i) => `$${i + 1}`).join(',');
    return (await history().query(`INSERT INTO tp1.sf_log_history (${cols}) VALUES (${ph}) RETURNING id`, vals)).rows[0].id;
}

/** All rows of the company's history table for that company, oldest id first. */
export async function historyRows(code) {
    const c = byCode(code);
    return (await history().query(`SELECT * FROM ${c.table} WHERE ${c.col} = $1 ORDER BY id`, [code])).rows;
}
export async function allHistoryRows() {
    const a = (await history().query('SELECT * FROM tp23.sf_log_history ORDER BY id')).rows;
    const b = (await history().query('SELECT * FROM tp1.sf_log_history ORDER BY id')).rows;
    return { tp23: a, tp1: b };
}

/** Schemas, tables, columns (with types), indexes and sequences of the history database. */
export async function historySchemaSnapshot() {
    const cols = await history().query(`SELECT table_schema, table_name, column_name, data_type, is_nullable, column_default
        FROM information_schema.columns WHERE table_schema NOT IN ('pg_catalog', 'information_schema')
        ORDER BY 1, 2, 3`);
    const idx = await history().query(`SELECT schemaname, tablename, indexname, indexdef FROM pg_indexes
        WHERE schemaname NOT IN ('pg_catalog', 'information_schema') ORDER BY 1, 2, 3`);
    const sch = await history().query(`SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' ORDER BY 1`);
    const rel = await history().query(`SELECT n.nspname, c.relname, c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname NOT LIKE 'pg_%' AND n.nspname <> 'information_schema' AND c.relkind IN ('r','v','m','S','f','p') ORDER BY 1, 2`);
    return JSON.stringify({ schemas: sch.rows, relations: rel.rows, columns: cols.rows, indexes: idx.rows });
}
