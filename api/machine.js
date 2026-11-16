// Vercel Serverless Function — PostgreSQL(175.193.55.102:5432) syntec_cnc.raw_data 에서
// 설비(EQUIPMENT_NO)별 최신 1행을 조회해서 브라우저에 내려줍니다. 브라우저가 DB에 직접 붙지 않고
// 이 서버 쪽에서만 접속합니다 (계정/비밀번호가 클라이언트에 노출되면 안 되기 때문).
//
// 요청: GET /api/machine?eq=24424,42504,02895,75980
// 응답: { "24424": { ...최신 행 }, "42504": { ... }, "02895": null, ... }  (데이터 없는 설비는 null)
//
// 보안 주의:
// - 비밀번호는 이 파일에 직접 쓰지 말고 Vercel 환경변수 PG_PASSWORD로 설정하세요.
// - 쿼리는 서버에서 고정. 설비 번호는 숫자만 허용하고 파라미터($1)로만 전달.
//
// 컬럼 처리:
// - 테이블 컬럼 구성은 information_schema 에서 읽어서 사용합니다.
// - 설비 번호 컬럼 = 이름이 equipment_no 인 컬럼(대소문자 무관).
// - "최신 1행" 정렬 기준 = 첫 번째 날짜/시간형 컬럼. 응답의 created_at 에 그 값을 담습니다.
// - json/jsonb 컬럼은 안의 필드를 펼쳐서 최상위에 내려줍니다(그 외 컬럼은 그대로).

import { Client } from 'pg';

const PG_CONFIG = {
    host: '175.193.55.102',
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.PG_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 5000,
};

const TABLE_SCHEMA = 'syntec_cnc';
const TABLE_NAME = 'raw_data';
const EQUIPMENT_COLUMN = 'equipment_no';
const MAX_EQUIPMENTS = 8;

const COLUMNS_QUERY = `
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = $1 AND table_name = $2
ORDER BY ordinal_position
`;

const quoteIdent = (name) => `"${String(name).replace(/"/g, '""')}"`;

function flattenRow(row, cols, timeCol) {
    const out = {};
    for (const c of cols) {
        let v = row[c.column_name];
        if (c.data_type === 'json' || c.data_type === 'jsonb') {
            if (typeof v === 'string') {
                try { v = JSON.parse(v); } catch { /* 문자열 그대로 */ }
            }
            if (v && typeof v === 'object' && !Array.isArray(v)) {
                Object.assign(out, v);
                continue;
            }
        }
        out[c.column_name] = v;
    }
    if (timeCol) out.created_at = row[timeCol.column_name];
    return out;
}

export default async function handler(req, res) {
    if (!process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }

    const eqParam = String((req.query && req.query.eq) || '');
    const equipments = eqParam.split(',').map((s) => s.trim()).filter(Boolean);
    if (equipments.length === 0 || equipments.length > MAX_EQUIPMENTS || !equipments.every((e) => /^\d{1,20}$/.test(e))) {
        res.status(400).json({ error: 'invalid_eq', message: 'eq 파라미터에 숫자 설비 번호를 쉼표로 구분해 넣어야 합니다.' });
        return;
    }

    const client = new Client(PG_CONFIG);
    try {
        await client.connect();

        const cols = (await client.query(COLUMNS_QUERY, [TABLE_SCHEMA, TABLE_NAME])).rows;
        if (cols.length === 0) {
            res.status(500).json({ error: 'table_not_found', table: `${TABLE_SCHEMA}.${TABLE_NAME}` });
            return;
        }
        const eqCol = cols.find((c) => c.column_name.toLowerCase() === EQUIPMENT_COLUMN);
        if (!eqCol) {
            res.status(500).json({ error: 'equipment_column_not_found', column: EQUIPMENT_COLUMN });
            return;
        }

        const timeCol = cols.find((c) => /timestamp|date/.test(c.data_type));
        const orderBy = timeCol ? `ORDER BY ${quoteIdent(timeCol.column_name)} DESC` : '';
        // 숫자형 컬럼이면 숫자로 비교, 문자형이면 문자 그대로 비교 (예: '02895' 앞자리 0 유지)
        const isNumeric = /int|numeric|double|real|decimal/.test(eqCol.data_type);
        const where = isNumeric
            ? `${quoteIdent(eqCol.column_name)} = $1::numeric`
            : `${quoteIdent(eqCol.column_name)}::text = $1`;
        const query = `SELECT * FROM ${quoteIdent(TABLE_SCHEMA)}.${quoteIdent(TABLE_NAME)} WHERE ${where} ${orderBy} LIMIT 1`;

        const out = {};
        for (const eq of equipments) {
            const result = await client.query(query, [eq]);
            out[eq] = result.rows.length ? flattenRow(result.rows[0], cols, timeCol) : null;
        }

        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(out);
    } catch (err) {
        res.status(500).json({ error: 'db_query_failed', message: String(err) });
    } finally {
        try {
            await client.end();
        } catch {
            // 연결 종료 실패는 무시
        }
    }
}
