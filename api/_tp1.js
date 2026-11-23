// 경기TP 스마트공장 유형1 — 공통 설정·로그 전송·이력 저장. 2-3(TP23) 코드와 테이블은 건드리지 않음.
// 파일명이 _ 로 시작해 API 경로로 노출되지 않음.
//
// 대상 업체(유형1): (주)CDR시스템 — 코드 CDR
// 데이터 출처: 센서(InfluxDB 175.193.55.102:8086). 최근 10분 동안 해당 센서 데이터가 실제로 쌓였으면 DO6004 1건.
// 로그인·로그아웃: /tp1.html 에서 실제 로그인·로그아웃할 때 DO6001 / DO6002 1건.
// 이력: tp1.sf_log_history (2-3의 tp23.sf_log_history 와 분리)
//
// 환경변수 (Vercel / 회사 서버 .env.tp1, 값은 코드에 쓰지 않음)
// - PG_PASSWORD                 DB 비밀번호 (2-3과 같은 DB)
// - INFLUX_TOKEN                InfluxDB 읽기 토큰
// - SF_LOG_KEY_TP1_CDR          (주)CDR시스템 사업관리시스템 로그API 인증키
// - TP1_PASSWORD_CDR            /tp1.html 로그인 비밀번호
// - TP1_INFLUX_BUCKET_CDR       센서 버킷 이름
// - TP1_INFLUX_TOPIC_CDR        센서 topic 태그 값 (예: YC_2025/xxxxx)
// - TP1_INFLUX_ORG              (선택) InfluxDB org, 기본 dx
// - TP1_LOG_IP_CDR              (선택) DO6004 접속 IP. 없으면 SF_LOG_DEFAULT_IP 또는 DB 서버 IP

import { DB_HOST, USE_SE, kstLogDt, sendSfLog } from './_sf-send.js';
import { describeResult } from './_sf-codes.js';

export const TP1_LOG_WINDOW_MIN = 10;

// 업체를 추가할 때는 여기에 한 줄 + 위 환경변수(코드만 바꿔서)를 추가
export const TP1_COMPANIES = {
    CDR: { name: '(주)CDR시스템' },
};

export const tp1Key = (code) => process.env[`SF_LOG_KEY_TP1_${code}`];
export const tp1Password = (code) => process.env[`TP1_PASSWORD_${code}`];

// 로그인 아이디 비교용: 공백, (주), 주식회사 무시 + 대소문자 무시
export const normalizeName = (s) => String(s || '').replace(/\s+/g, '').replace(/\(주\)|㈜|주식회사/g, '').toLowerCase();
export function findCompany(id) {
    return Object.keys(TP1_COMPANIES).find((c) => normalizeName(TP1_COMPANIES[c].name) === normalizeName(id)) || null;
}

const DDL = `
CREATE SCHEMA IF NOT EXISTS tp1;
CREATE TABLE IF NOT EXISTS tp1.sf_log_history (
    id            bigserial PRIMARY KEY,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    company_code  varchar(10) NOT NULL,
    source        varchar(10) NOT NULL,
    test          boolean     NOT NULL,
    use_se        varchar(10) NOT NULL,
    log_dt        varchar(23) NOT NULL,
    sys_user      varchar(60) NOT NULL,
    conect_ip     varchar(30) NOT NULL,
    data_usgqty   bigint      NOT NULL,
    http_status   integer,
    result_code   varchar(10),
    result_msg    varchar(200),
    result_detail text,
    recptn_dt     varchar(30),
    error         text
);
CREATE INDEX IF NOT EXISTS sf_log_history_sent_at_idx ON tp1.sf_log_history (sent_at DESC);
`;

let ensured = false;
export async function ensureTp1History(client) {
    if (ensured) return;
    await client.query(DDL);
    ensured = true;
}

// row: { code, source: 'login'|'logout'|'sensor', test, fields, response?, error? }
export async function insertTp1History(client, row) {
    await ensureTp1History(client);
    const r = row.response || {};
    await client.query(
        `INSERT INTO tp1.sf_log_history
            (company_code, source, test, use_se, log_dt, sys_user, conect_ip, data_usgqty,
             http_status, result_code, result_msg, result_detail, recptn_dt, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.code, row.source, row.test, row.fields.useSe, row.fields.logDt, row.fields.sysUser,
            row.fields.conectIp, Number(row.fields.dataUsgqty) || 0, r.http ?? null, r.code ?? null,
            r.message ? String(r.message).slice(0, 200) : null, r.detail ?? null, r.at ?? null, row.error ?? null]
    );
}

// 사업관리시스템 1건 전송 → { fields, response?, error?, result }
export async function sendTp1Log(code, { useSe, test, conectIp, dataUsgqty }) {
    const key = tp1Key(code);
    const fields = {
        crtfcKey: key || '',
        logDt: kstLogDt(),
        useSe: test ? USE_SE.test : useSe,
        sysUser: TP1_COMPANIES[code].name,
        conectIp: String(conectIp || 'unknown').slice(0, 30),
        dataUsgqty: String(Number(dataUsgqty) || 0),
    };
    let response;
    let error;
    if (!key) error = 'missing_key';
    else {
        try { response = await sendSfLog(fields); } catch (err) { error = `send_failed: ${String(err)}`; }
    }
    return { fields, response, error, result: describeResult(response && response.code, error) };
}

// ── 센서 데이터(InfluxDB) 최근 N분 건수·바이트 ──
// INFLUX_URL overrides the server (e.g. http://sl-influxdb:8086 in Docker); default = DB server.
const INFLUX_BASE = `${(process.env.INFLUX_URL || 'http://175.193.55.102:8086').replace(/\/+$/, '')}/api/v2/query`;
const SAFE = /^[\w./:-]{1,120}$/; // Flux 문자열에 넣을 값은 이 문자만 허용

export function sensorConfig(code) {
    const bucket = process.env[`TP1_INFLUX_BUCKET_${code}`] || '';
    const topic = process.env[`TP1_INFLUX_TOPIC_${code}`] || '';
    const org = process.env.TP1_INFLUX_ORG || 'dx';
    return { bucket, topic, org, ok: SAFE.test(bucket) && SAFE.test(topic) && SAFE.test(org) };
}

export async function countSensorData(code, minutes) {
    const cfg = sensorConfig(code);
    if (!process.env.INFLUX_TOKEN) throw new Error('INFLUX_TOKEN 없음');
    if (!cfg.ok) throw new Error(`센서 설정 없음(TP1_INFLUX_BUCKET_${code}, TP1_INFLUX_TOPIC_${code})`);
    const flux = `
from(bucket: "${cfg.bucket}")
  |> range(start: -${Math.max(1, Math.floor(minutes))}m)
  |> filter(fn: (r) => r.topic == "${cfg.topic}")
  |> keep(columns: ["_time", "_field", "_value"])
`;
    const r = await fetch(`${INFLUX_BASE}?org=${encodeURIComponent(cfg.org)}`, {
        method: 'POST',
        headers: { Authorization: `Token ${process.env.INFLUX_TOKEN}`, 'Content-Type': 'application/vnd.flux', Accept: 'application/csv' },
        body: flux,
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`InfluxDB ${r.status}: ${text.slice(0, 200)}`);
    let rows = 0;
    let bytes = 0;
    let lastAt = null;
    let header = null;
    for (const raw of text.split('\n')) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const cols = line.split(',');
        if (cols.includes('_value') && cols.includes('_field')) { header = cols; continue; }
        if (!header || cols.length !== header.length) continue;
        rows++;
        bytes += Buffer.byteLength(line);
        const t = cols[header.indexOf('_time')];
        if (t && (!lastAt || t > lastAt)) lastAt = t;
    }
    return { rows, bytes, last_at: lastAt };
}

// ── DO6004(데이터 등록): 업체별 최근 10분 센서 데이터가 있으면 1건 ──
// pgClient 는 연결된 상태로 넘김. dry = 전송·기록 없이 확인만, test = DO6999
export async function runTp1SfLog(pgClient, { dry = false, test = false, codes } = {}) {
    const out = { window_min: TP1_LOG_WINDOW_MIN, mode: dry ? 'dry' : test ? 'test' : 'send', results: {} };
    for (const code of codes || Object.keys(TP1_COMPANIES)) {
        const item = { name: TP1_COMPANIES[code].name, key_set: Boolean(tp1Key(code)) };
        out.results[code] = item;
        try {
            Object.assign(item, await countSensorData(code, TP1_LOG_WINDOW_MIN));
        } catch (err) {
            item.error = `sensor_failed: ${err.message || err}`;
            continue;
        }
        if (!test && item.rows === 0) { item.skipped = 'no_new_data'; continue; }
        const conectIp = process.env[`TP1_LOG_IP_${code}`] || process.env.SF_LOG_DEFAULT_IP || DB_HOST;
        if (dry) {
            item.log = { useSe: test ? USE_SE.test : USE_SE.register, sysUser: TP1_COMPANIES[code].name, conectIp, dataUsgqty: String(item.bytes) };
            continue;
        }
        const sent = await sendTp1Log(code, { useSe: USE_SE.register, test, conectIp, dataUsgqty: item.bytes });
        item.log = { ...sent.fields, crtfcKey: sent.fields.crtfcKey ? '(set)' : '(missing)' };
        item.result = sent.result;
        try {
            await insertTp1History(pgClient, { code, source: 'sensor', test, fields: sent.fields, response: sent.response, error: sent.error });
        } catch (err) {
            item.history_error = String(err);
        }
    }
    return out;
}
