// Vercel Serverless Function — 스마트공장 로그 송수신 이력 조회(tp23.sf_log_history).
// GET /api/sf-log-history?days=7[&set=A] → { summary: 날짜·업체별 요약, rows: 최근 이력(최대 500건, 최신순), codes: 결과 코드표 }
// 각 행·요약에 결과 의미(meaning)·수준(level: ok/test/info/error)·조치(action)를 붙임.
// 접속 IP는 DB에만 저장하고 응답·화면에는 내보내지 않음.
// 화면: /sflog.html

import { Client } from 'pg';
import { ensureHistoryTable, SUMMARY_SQL, SET_NAMES } from './_sf-history.js';
import { SF_RESULT_CODES, describeResult } from './_sf-codes.js';

const PG_CONFIG = {
    host: '175.193.55.102',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.PG_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 5000,
};

const ROWS_SQL = `
SELECT id,
       to_char(sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS sent_at_kst,
       set_code, equipment_no, test, use_se, log_dt, sys_user, data_usgqty,
       http_status, result_code, result_msg, result_detail, recptn_dt, error
FROM tp23.sf_log_history
WHERE sent_at >= now() - make_interval(days => $1)
  AND ($2::text IS NULL OR set_code = $2)
ORDER BY sent_at DESC
LIMIT 500
`;

export default async function handler(req, res) {
    if (!process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }
    const query = req.query || {};
    const days = Math.min(90, Math.max(1, Number.parseInt(query.days, 10) || 7));
    const set = SET_NAMES[String(query.set || '').toUpperCase()] ? String(query.set).toUpperCase() : null;

    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        await ensureHistoryTable(client);
        const summary = (await client.query(SUMMARY_SQL, [days])).rows
            .filter((r) => !set || r.set_code === set)
            .map((r) => ({ ...r, name: SET_NAMES[r.set_code], last: describeResult(r.last_code, r.last_error) }));
        const rows = (await client.query(ROWS_SQL, [days, set])).rows
            .map((r) => ({ ...r, name: SET_NAMES[r.set_code], data_usgqty: Number(r.data_usgqty), ...describeResult(r.result_code, r.error), code: r.result_code }));
        res.setHeader('Cache-Control', 'no-store');
        const codes = Object.entries(SF_RESULT_CODES).map(([code, v]) => ({ code, ...v }));
        res.status(200).json({ days, set, summary, rows, codes });
    } catch (err) {
        res.status(500).json({ error: 'db_query_failed', message: String(err) });
    } finally {
        try { await client.end(); } catch { /* 연결 종료 실패는 무시 */ }
    }
}
