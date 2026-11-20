// 스마트공장 사업관리시스템 로그 전송 공통 — api/sf-log.js(설비 데이터 등록), api/sf-auth.js(로그인·로그아웃).
// 파일명이 _ 로 시작해 API 경로로 노출되지 않음.

export const SF_LOG_URL = 'https://log.smart-factory.kr/apisvc/sendLogData.json';
export const DB_HOST = '175.193.55.102';

export const PG_CONFIG = {
    host: DB_HOST,
    port: 5432,
    database: 'postgres',
    user: 'postgres',
    password: process.env.PG_PASSWORD,
    ssl: false,
    connectionTimeoutMillis: 5000,
};

// 사용 구분 코드(연동규격서 v1.7)
export const USE_SE = { login: 'DO6001', logout: 'DO6002', register: 'DO6004', test: 'DO6999' };

// 설비 코드 → DB EQUIPMENT_NO (main.js SET_EQUIPMENT_NO와 같은 값)
export const SET_EQUIPMENT_NO = { A: '24424', B: '42504', C: '02895', D: '75980' };

export const sfKey = (set) => process.env[`SF_LOG_KEY_${set}`];

const pad = (n, w = 2) => String(n).padStart(w, '0');
// 한국 시간 "YYYY-MM-DD HH:MI:SS.SSS"
export function kstLogDt(date = new Date()) {
    const t = new Date(date.getTime() + 9 * 60 * 60 * 1000);
    return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())} `
        + `${pad(t.getUTCHours())}:${pad(t.getUTCMinutes())}:${pad(t.getUTCSeconds())}.${pad(t.getUTCMilliseconds(), 3)}`;
}

// 요청한 사람의 실제 IP (Vercel은 x-forwarded-for 첫 값)
export function clientIp(req) {
    const xff = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const ip = xff || String(req.headers['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || '';
    return ip.replace(/^::ffff:/, '').slice(0, 30);
}

// 결과: { http, code, message, detail, at }
export async function sendSfLog(fields) {
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
