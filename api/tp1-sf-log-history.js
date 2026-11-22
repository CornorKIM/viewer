// Vercel Serverless Function — 유형1 로그 전송 이력 조회(tp1.sf_log_history). 화면: /tp1.html
// GET /api/tp1-sf-log-history?days=7 → { days, rows: 최근 이력(최대 200건, 최신순) }
// 접속 IP는 DB에만 저장하고 응답에는 내보내지 않음.

import { Client } from 'pg';
import { PG_CONFIG } from './_sf-send.js';
import { describeResult } from './_sf-codes.js';
import { ensureTp1History, TP1_COMPANIES } from './_tp1.js';

const ROWS_SQL = `
SELECT id, to_char(sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI:SS') AS sent_at_kst,
       company_code, source, test, use_se, data_usgqty, result_code, error
FROM tp1.sf_log_history
WHERE sent_at >= now() - make_interval(days => $1)
ORDER BY sent_at DESC
LIMIT 200
`;

export default async function handler(req, res) {
    if (!process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }
    const days = Math.min(90, Math.max(1, Number.parseInt((req.query || {}).days, 10) || 7));
    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        await ensureTp1History(client);
        const rows = (await client.query(ROWS_SQL, [days])).rows.map((r) => ({
            ...r,
            name: (TP1_COMPANIES[r.company_code] || {}).name || r.company_code,
            data_usgqty: Number(r.data_usgqty),
            ...describeResult(r.result_code, r.error),
            code: r.result_code,
        }));
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json({ days, rows });
    } catch (err) {
        res.status(500).json({ error: 'db_query_failed', message: String(err) });
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
}
