// Vercel Serverless Function — 스마트공장 로그 송수신 이력 조회(tp23.sf_log_history + 유형1 tp1.sf_log_history).
// GET /api/sf-log-history?days=7[&set=A|CDR]  (유형1 업체는 set 값으로 회사 코드 사용) → { summary: 날짜·업체별 요약, rows: 최근 이력(최대 500건, 최신순), codes: 결과 코드표 }
// 각 행·요약에 결과 의미(meaning)·수준(level: ok/test/info/error)·조치(action)를 붙임.
// 접속 IP는 DB에만 저장하고 응답·화면에는 내보내지 않음.
// 화면: /sflog.html

import { Client } from 'pg';
import { ensureHistoryTable, SUMMARY_SQL, SET_NAMES } from './_sf-history.js';
import { ensureTp1History, TP1_COMPANIES } from './_tp1.js';
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

// 유형1(tp1.sf_log_history)을 같은 모양으로: set_code = 회사 코드, 장비 칸 = 시스템 사용자
const TP1_SUMMARY_SQL = SUMMARY_SQL
    .replace('FROM tp23.sf_log_history', 'FROM tp1.sf_log_history')
    .replace(/\bset_code\b/g, 'company_code AS set_code')
    .replace('GROUP BY 1, 2', 'GROUP BY 1, company_code')
    .replace('ORDER BY 1 DESC, 2', 'ORDER BY 1 DESC, company_code');

const TP1_ROWS_SQL = `
SELECT id,
       to_char(sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS sent_at_kst,
       company_code AS set_code, sys_user AS equipment_no, test, use_se, log_dt, sys_user, data_usgqty,
       http_status, result_code, result_msg, result_detail, recptn_dt, error, sent_at
FROM tp1.sf_log_history
WHERE sent_at >= now() - make_interval(days => $1)
  AND ($2::text IS NULL OR company_code = $2)
ORDER BY sent_at DESC
LIMIT 500
`;

const nameOf = (code) => SET_NAMES[code] || (TP1_COMPANIES[code] || {}).name || code;

export default async function handler(req, res) {
    if (!process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }
    const query = req.query || {};
    const days = Math.min(90, Math.max(1, Number.parseInt(query.days, 10) || 7));
    const wanted = String(query.set || '').toUpperCase();
    const set = SET_NAMES[wanted] || TP1_COMPANIES[wanted] ? wanted : null;
    const wantTp23 = !set || Boolean(SET_NAMES[set]);
    const wantTp1 = !set || Boolean(TP1_COMPANIES[set]);

    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        await ensureHistoryTable(client);
        await ensureTp1History(client);
        const summaryRows = [
            ...(wantTp23 ? (await client.query(SUMMARY_SQL, [days])).rows : []),
            ...(wantTp1 ? (await client.query(TP1_SUMMARY_SQL, [days])).rows : []),
        ];
        const summary = summaryRows
            .filter((r) => !set || r.set_code === set)
            .sort((a, b) => b.day.localeCompare(a.day) || (a.set_code.length - b.set_code.length) || a.set_code.localeCompare(b.set_code))
            .map((r) => ({ ...r, name: nameOf(r.set_code), last: describeResult(r.last_code, r.last_error) }));
        const tp23Rows = wantTp23 ? (await client.query(ROWS_SQL, [days, set])).rows : [];
        const tp1Rows = wantTp1 ? (await client.query(TP1_ROWS_SQL, [days, set])).rows : [];
        const rows = [...tp23Rows, ...tp1Rows]
            .sort((a, b) => b.sent_at_kst.localeCompare(a.sent_at_kst))
            .slice(0, 500)
            .map(({ sent_at, ...r }) => ({ ...r, name: nameOf(r.set_code), data_usgqty: Number(r.data_usgqty), ...describeResult(r.result_code, r.error), code: r.result_code }));
        res.setHeader('Cache-Control', 'no-store');
        const codes = Object.entries(SF_RESULT_CODES).map(([code, v]) => ({ code, ...v }));
        res.status(200).json({ days, set, summary, rows, codes });
    } catch (err) {
        res.status(500).json({ error: 'db_query_failed', message: String(err) });
    } finally {
        try { await client.end(); } catch { /* 연결 종료 실패는 무시 */ }
    }
}
