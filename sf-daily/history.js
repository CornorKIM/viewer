// The shared history tables (docs/spec/interfaces/sf-log-history.md): sf-daily only reads counts and
// appends rows. It never creates or alters anything in that database.
import { historyQuery } from './db.js';

const TABLE = {
    tp23: { name: 'tp23.sf_log_history', col: 'set_code' },
    tp1: { name: 'tp1.sf_log_history', col: 'company_code' },
};
const tableOf = (company) => TABLE[company.history];

/** Normal-save count of company · KST date · use_se (the contract's one count). */
export async function normalSaveCount(company, date, useSe) {
    const t = tableOf(company);
    const r = await historyQuery(
        `SELECT count(*)::int AS n FROM ${t.name}
          WHERE ${t.col} = $1 AND (sent_at AT TIME ZONE 'Asia/Seoul')::date = $2::date
            AND use_se = $3 AND result_code = 'AP1002' AND test = false`,
        [company.code, date, useSe],
    );
    return r.rows[0].n;
}

/** Normal-save counts of every use_se of the given companies on a KST date: { code: { useSe: n } }. */
export async function normalSaveCounts(companies, date) {
    const out = Object.fromEntries(companies.map((c) => [c.code, {}]));
    for (const key of Object.keys(TABLE)) {
        const codes = companies.filter((c) => c.history === key).map((c) => c.code);
        if (!codes.length) continue;
        const t = TABLE[key];
        const r = await historyQuery(
            `SELECT ${t.col} AS code, use_se, count(*)::int AS n FROM ${t.name}
              WHERE ${t.col} = ANY($1) AND (sent_at AT TIME ZONE 'Asia/Seoul')::date = $2::date
                AND result_code = 'AP1002' AND test = false
              GROUP BY 1, 2`,
            [codes, date],
        );
        for (const row of r.rows) out[String(row.code).trim()][row.use_se] = row.n;
    }
    return out;
}

/** Did the company's most recent request (largest sent_at, any row) happen less than `minutes` ago? */
export async function requestedWithin(company, minutes) {
    const t = tableOf(company);
    const r = await historyQuery(
        `SELECT (max(sent_at) > now() - make_interval(mins => $2)) AS recent FROM ${t.name} WHERE ${t.col} = $1`,
        [company.code, minutes],
    );
    return r.rows[0].recent === true;
}

/**
 * Appends one row for a request that went to the log API. Returns { table, id }.
 * fields: the sent log values except the key. response: { http, code, message, detail, at } | null.
 */
export async function appendRow(company, fields, response, error) {
    const t = tableOf(company);
    const r = response || {};
    const common = [false, fields.useSe, fields.logDt, fields.sysUser, fields.conectIp, Number(fields.dataUsgqty) || 0,
        r.http ?? null, r.code ? String(r.code).slice(0, 10) : null, r.message ? String(r.message).slice(0, 200) : null,
        r.detail ? String(r.detail) : null, r.at ? String(r.at).slice(0, 30) : null, error ?? null];
    const sql = company.history === 'tp23'
        ? `INSERT INTO tp23.sf_log_history (set_code, equipment_no, test, use_se, log_dt, sys_user, conect_ip, data_usgqty,
               http_status, result_code, result_msg, result_detail, recptn_dt, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`
        : `INSERT INTO tp1.sf_log_history (company_code, source, test, use_se, log_dt, sys_user, conect_ip, data_usgqty,
               http_status, result_code, result_msg, result_detail, recptn_dt, error)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`;
    const head = company.history === 'tp23' ? [company.code, company.equipmentNo] : [company.code, 'auto'];
    const res = await historyQuery(sql, [...head, ...common]);
    return { table: t.name, id: String(res.rows[0].id) };
}
