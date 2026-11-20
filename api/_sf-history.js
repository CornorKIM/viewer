// 스마트공장 로그 송수신 이력 — 기존 PostgreSQL에 전용 스키마·테이블(tp23.sf_log_history)로 저장.
// 설비 데이터 테이블(syntec_cnc.raw_data)은 건드리지 않음. 파일명이 _ 로 시작해 API 경로로 노출되지 않음.

import { SF_ERROR_FILTER_SQL } from './_sf-codes.js';

export const SET_NAMES = { A: '목공소 봄', B: '이레공방', C: '브랜드스미스', D: '비스트럭처' };

const DDL = `
CREATE SCHEMA IF NOT EXISTS tp23;
CREATE TABLE IF NOT EXISTS tp23.sf_log_history (
    id            bigserial PRIMARY KEY,
    sent_at       timestamptz NOT NULL DEFAULT now(),
    set_code      char(1)     NOT NULL,
    equipment_no  varchar(20) NOT NULL,
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
CREATE INDEX IF NOT EXISTS sf_log_history_sent_at_idx ON tp23.sf_log_history (sent_at DESC);
`;

let ensured = false; // 같은 서버 인스턴스에서는 한 번만 확인
export async function ensureHistoryTable(client) {
    if (ensured) return;
    await client.query(DDL);
    ensured = true;
}

// row: { set, equipmentNo, test, fields: {logDt, useSe, sysUser, conectIp, dataUsgqty}, response?, error? }
export async function insertHistory(client, row) {
    await ensureHistoryTable(client);
    const r = row.response || {};
    await client.query(
        `INSERT INTO tp23.sf_log_history
            (set_code, equipment_no, test, use_se, log_dt, sys_user, conect_ip, data_usgqty,
             http_status, result_code, result_msg, result_detail, recptn_dt, error)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [row.set, row.equipmentNo, row.test, row.fields.useSe, row.fields.logDt, row.fields.sysUser,
            row.fields.conectIp, Number(row.fields.dataUsgqty) || 0, r.http ?? null, r.code ?? null,
            r.message ? String(r.message).slice(0, 200) : null, r.detail ?? null, r.at ?? null, row.error ?? null]
    );
}

// 한국 날짜(YYYY-MM-DD)별·업체별 요약: 전송 건수, 정상 저장(AP1002), 테스트 건수, 오류 건수, 마지막 결과
export const SUMMARY_SQL = `
SELECT to_char(sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') AS day,
       set_code,
       count(*)::int                                              AS sent,
       count(*) FILTER (WHERE result_code = 'AP1002')::int        AS ok,
       count(*) FILTER (WHERE test)::int                          AS tests,
       count(*) FILTER (WHERE ${SF_ERROR_FILTER_SQL})::int         AS errors,
       (array_agg(result_code ORDER BY sent_at DESC))[1]          AS last_code,
       (array_agg(error ORDER BY sent_at DESC))[1]                AS last_error,
       to_char(max(sent_at) AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS last_at
FROM tp23.sf_log_history
WHERE sent_at >= now() - make_interval(days => $1)
GROUP BY 1, 2
ORDER BY 1 DESC, 2
`;
