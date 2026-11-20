// 스마트공장 사업관리시스템 로그 전송 — 회사 서버 단독 실행판 (Vercel 없이 동작).
// 미니PC → DB(syntec_cnc.raw_data) 등록 → 이 프로그램(10분마다) → 사업관리시스템(log.smart-factory.kr)
//
// 동작은 api/sf-log.js 와 같다: 업체별로 최근 LOG_WINDOW_MIN 분 동안 DB에 실제 등록된 데이터가 있으면
// 그 업체 인증키로 DO6004(데이터 등록) 1건 전송, 없으면 전송하지 않음. 결과는 tp23.sf_log_history 에 저장
// (뷰어의 /sflog.html 이력 화면에서 그대로 보임).
//
// 실행:  node --env-file=.env sf-log-runner.mjs            전송
//        node --env-file=.env sf-log-runner.mjs --dry      전송 없이 내용만 출력
//        node --env-file=.env sf-log-runner.mjs --test     DO6999(테스트, 통계 제외)로 키·형식 확인
//        node --env-file=.env sf-log-runner.mjs --set=A,C  일부 업체만
// 설정: 같은 폴더의 .env (예시 env.example). 10분 간격 자동 실행은 install-task.bat 으로 등록.

import pg from 'pg';
import { insertHistory } from '../api/_sf-history.js';
import { describeResult } from '../api/_sf-codes.js';
import { DB_HOST, PG_CONFIG, USE_SE, SET_EQUIPMENT_NO, sfKey, kstLogDt, sendSfLog } from '../api/_sf-send.js';

const LOG_WINDOW_MIN = 10; // 사업관리시스템은 10분 간격으로만 저장 → 10분마다 실행

const REGISTERED_QUERY = `
SELECT count(*)::int AS rows,
       coalesce(sum(octet_length(collected_data::text)), 0)::bigint AS bytes,
       max(collected_at) AS last_at
FROM syntec_cnc.raw_data
WHERE equipment_no::text = $1
  AND collected_at > now() - make_interval(mins => $2)
`;

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const test = !dry && args.includes('--test');
const setArg = (args.find((a) => a.startsWith('--set=')) || '').slice(6);
const sets = setArg
    ? setArg.toUpperCase().split(',').filter((s) => SET_EQUIPMENT_NO[s])
    : Object.keys(SET_EQUIPMENT_NO);

const stamp = () => kstLogDt().slice(0, 19);
const log = (msg) => console.log(`[${stamp()}] ${msg}`);

async function main() {
    if (!process.env.PG_PASSWORD) {
        log('오류: PG_PASSWORD 가 없습니다. .env 파일을 확인하세요.');
        process.exitCode = 1;
        return;
    }
    if (sets.length === 0) {
        log('오류: --set 은 A, B, C, D 중에서 지정하세요.');
        process.exitCode = 1;
        return;
    }

    // 이 프로그램이 DB 서버와 같은 장비면 PG_HOST=localhost 로 지정 가능
    const client = new pg.Client({ ...PG_CONFIG, host: process.env.PG_HOST || PG_CONFIG.host });
    const mode = dry ? 'dry' : test ? 'test' : 'send';
    try {
        await client.connect();
        for (const set of sets) {
            const equipmentNo = SET_EQUIPMENT_NO[set];
            const { rows } = await client.query(REGISTERED_QUERY, [equipmentNo, LOG_WINDOW_MIN]);
            const reg = rows[0];
            const key = sfKey(set);
            const head = `${set}(${equipmentNo}) 최근 ${LOG_WINDOW_MIN}분 등록 ${reg.rows}건 ${Number(reg.bytes)}B`;

            if (!test && reg.rows === 0) {
                log(`${head} → 등록 없음, 전송 안 함`);
                continue;
            }
            const fields = {
                crtfcKey: key || '',
                logDt: kstLogDt(),
                useSe: test ? USE_SE.test : USE_SE.register,
                sysUser: equipmentNo,
                conectIp: process.env[`SF_LOG_IP_${set}`] || process.env.SF_LOG_DEFAULT_IP || DB_HOST,
                dataUsgqty: String(Number(reg.bytes)),
            };
            if (dry) {
                log(`${head} → [확인] ${fields.useSe} 전송 예정 (키 ${key ? '있음' : '없음'})`);
                continue;
            }

            let response;
            let error;
            if (!key) {
                error = 'missing_key';
            } else {
                try {
                    response = await sendSfLog(fields);
                } catch (err) {
                    error = `send_failed: ${String(err)}`;
                }
            }
            const result = describeResult(response && response.code, error);
            log(`${head} → ${fields.useSe} ${result.code} ${result.meaning}${result.action ? ` / ${result.action}` : ''}`);
            try {
                await insertHistory(client, { set, equipmentNo, test, fields, response, error });
            } catch (err) {
                log(`  이력 저장 실패: ${String(err)}`);
            }
        }
        log(`완료 (${mode})`);
    } catch (err) {
        log(`오류: DB 연결·조회 실패 — ${String(err)}`);
        process.exitCode = 1;
    } finally {
        try { await client.end(); } catch { /* 연결 종료 실패는 무시 */ }
    }
}

await main();
