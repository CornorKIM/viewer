// 경기TP 유형1 DO6004(데이터 등록) 전송 — 회사 서버 실행판. 동작은 /api/tp1-sf-log 와 같음.
// 업체별로 최근 10분 센서 데이터(InfluxDB)가 있으면 1건 전송, 없으면 안 보냄. 결과는 tp1.sf_log_history.
// 2-3(sf-log-runner.mjs, tp23 테이블)과 완전히 분리되어 동작.
//
// 실행:  node --env-file=.env.tp1 tp1-sf-log-runner.mjs           전송
//        node --env-file=.env.tp1 tp1-sf-log-runner.mjs --dry     전송 없이 확인만
//        node --env-file=.env.tp1 tp1-sf-log-runner.mjs --test    DO6999(테스트, 통계 제외)
// 10분 자동 실행: install-task-tp1.bat

import pg from 'pg';
import { kstLogDt, PG_CONFIG } from '../api/_sf-send.js';
import { runTp1SfLog } from '../api/_tp1.js';

const args = process.argv.slice(2);
const dry = args.includes('--dry');
const test = !dry && args.includes('--test');
const log = (msg) => console.log(`[${kstLogDt().slice(0, 19)}] ${msg}`);

function print(out) {
    for (const [code, it] of Object.entries(out.results)) {
        const head = `TP1 ${code} ${it.name}`;
        if (it.error && !it.result) { log(`${head} → 오류: ${it.error}`); continue; }
        const cnt = `최근 ${out.window_min}분 센서 ${it.rows}건 ${it.bytes}B`;
        if (it.skipped) { log(`${head} ${cnt} → 데이터 없음, 전송 안 함`); continue; }
        if (dry) { log(`${head} ${cnt} → [확인] ${it.log.useSe} 전송 예정 (키 ${it.key_set ? '있음' : '없음'})`); continue; }
        const r = it.result;
        log(`${head} ${cnt} → ${it.log.useSe} ${r.code} ${r.meaning}${r.action ? ` / ${r.action}` : ''}`);
        if (it.history_error) log(`  이력 저장 실패: ${it.history_error}`);
    }
    log(`완료 (${out.mode})`);
}

async function main() {
    if (dry) { print(await runTp1SfLog(null, { dry: true })); return; }
    if (!process.env.PG_PASSWORD) { log('오류: PG_PASSWORD 가 없습니다. .env.tp1 을 확인하세요.'); process.exitCode = 1; return; }
    const client = new pg.Client({ ...PG_CONFIG, host: process.env.PG_HOST || PG_CONFIG.host });
    try {
        await client.connect();
        print(await runTp1SfLog(client, { test }));
    } catch (err) {
        log(`오류: ${String(err)}`);
        process.exitCode = 1;
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
}

await main();
