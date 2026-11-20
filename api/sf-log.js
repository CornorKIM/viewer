// Vercel Serverless Function — 스마트공장 사업관리시스템 로그 수집 API(TIPA) 전송.
// 업체별 설비(미니PC)가 최근 LOG_WINDOW_MIN 분 동안 DB(syntec_cnc.raw_data)에 실제로 데이터를
// 등록했으면, 그 업체 인증키로 DO6004(데이터 등록) 로그를 1건 보낸다. 등록이 없으면 보내지 않음.
// 10분마다 호출(.github/workflows/sf-log.yml)하는 것을 전제로 함 — 수집 시스템은 10분 간격으로만 저장.
//
// 환경변수(Vercel):
// - PG_PASSWORD                          (필수) DB 비밀번호
// - SF_LOG_KEY_A / _B / _C / _D          업체별 로그API 인증키(사업관리시스템 > 솔루션 사용현황 > 로그API 인증키 관리)
// - SF_LOG_IP_A / _B / _C / _D           (선택) 접속 IP. 없으면 SF_LOG_DEFAULT_IP 또는 DB 서버 IP
// - CRON_SECRET                          (선택) 설정하면 Authorization: Bearer <값> 없는 호출을 막음
//
// 호출: GET /api/sf-log              → 모든 업체 확인 후 등록이 있는 업체만 DO6004 전송
//       GET /api/sf-log?set=A        → 한 업체만
//       GET /api/sf-log?dry=1        → 전송 없이 업체별 등록 건수·바이트·전송 예정 내용만 반환(키는 등록 여부만)
//       GET /api/sf-log?dry=1&window=1440 → 확인 모드에서만 조회 기간(분) 변경(최대 30일)
//       GET /api/sf-log?test=1       → 등록 여부와 관계없이 DO6999(테스트, 통계 제외)로 전송해 키·형식 확인
// 사업관리시스템 결과 코드 AP1002 = 정상 저장, AP1028 = 테스트 확인, AP1029 = 10분 이내 재전송(수신만).

import { Client } from 'pg';

const DB_HOST = '175.193.55.102';
const PG_CONFIG = {
    host: DB_HOST,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.PG_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 5000,
};

const SF_LOG_URL = 'https://log.smart-factory.kr/apisvc/sendLogData.json';
const LOG_WINDOW_MIN = 10;
const USE_SE_REGISTER = 'DO6004'; // 데이터 등록
const USE_SE_TEST = 'DO6999'; // 테스트 정보(통계 제외)

// 설비 코드 → DB EQUIPMENT_NO (main.js SET_EQUIPMENT_NO와 같은 값). 로그의 시스템 사용자(sysUser)로도 사용.
const SET_EQUIPMENT_NO = { A: '24424', B: '42504', C: '02895', D: '75980' };

const REGISTERED_QUERY = `
SELECT count(*)::int AS rows,
       coalesce(sum(octet_length(collected_data::text)), 0)::bigint AS bytes,
       max(collected_at) AS last_at
FROM syntec_cnc.raw_data
WHERE equipment_no::text = $1
  AND collected_at > now() - make_interval(mins => $2)
`;

const pad = (n, w = 2) => String(n).padStart(w, '0');
// 한국 시간 "YYYY-MM-DD HH:MI:SS.SSS"
function kstLogDt(date = new Date()) {
    const t = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} `
        + `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.${pad(t.getUTCMilliseconds(), 3)}`;
}

async function sendLog(fields) {
    const r = await fetch(SF_LOG_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: new URLSearchParams(fields).toString(),
    });
    const text = await r.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text.slice(0, 500) }; }
    const result = data.result || data;
    return { http: r.status, code: result.recptnRsltCd, message: result.recptnRslt, detail: result.recptnRsltDtl, at: result.recptnDt };
}

export default async function handler(req, res) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }

    const query = req.query || {};
    const dry = query.dry === '1';
    const test = !dry && query.test === '1';
    const windowMin = dry && /^\d+$/.test(String(query.window || '')) ? Math.min(Number(query.window), 43200) : LOG_WINDOW_MIN;
    const sets = query.set ? String(query.set).toUpperCase().split(',').filter((s) => SET_EQUIPMENT_NO[s]) : Object.keys(SET_EQUIPMENT_NO);
    if (sets.length === 0) {
        res.status(400).json({ error: 'invalid_set', message: 'set 은 A, B, C, D 중 하나(쉼표로 여러 개)여야 합니다.' });
        return;
    }

    const client = new Client(PG_CONFIG);
    const out = { window_min: windowMin, mode: dry ? 'dry' : test ? 'test' : 'send', results: {} };
    try {
        await client.connect();
        for (const set of sets) {
            const equipmentNo = SET_EQUIPMENT_NO[set];
            const { rows } = await client.query(REGISTERED_QUERY, [equipmentNo, windowMin]);
            const reg = rows[0];
            const key = process.env[`SF_LOG_KEY_${set}`];
            const item = { equipment_no: equipmentNo, registered_rows: reg.rows, registered_bytes: Number(reg.bytes), last_at: reg.last_at, key_set: Boolean(key) };
            out.results[set] = item;

            const shouldSend = test || reg.rows > 0;
            if (!shouldSend) {
                item.skipped = 'no_new_data';
                continue;
            }
            const fields = {
                crtfcKey: key || '',
                logDt: kstLogDt(),
                useSe: test ? USE_SE_TEST : USE_SE_REGISTER,
                sysUser: equipmentNo,
                conectIp: process.env[`SF_LOG_IP_${set}`] || process.env.SF_LOG_DEFAULT_IP || DB_HOST,
                dataUsgqty: String(Number(reg.bytes)),
            };
            item.log = { ...fields, crtfcKey: key ? '(set)' : '(missing)' };
            if (dry) continue;
            if (!key) {
                item.error = 'missing_key';
                continue;
            }
            try {
                item.response = await sendLog(fields);
            } catch (err) {
                item.error = `send_failed: ${String(err)}`;
            }
        }
        res.setHeader('Cache-Control', 'no-store');
        res.status(200).json(out);
    } catch (err) {
        res.status(500).json({ ...out, error: 'db_query_failed', message: String(err) });
    } finally {
        try { await client.end(); } catch { /* 연결 종료 실패는 무시 */ }
    }
}
