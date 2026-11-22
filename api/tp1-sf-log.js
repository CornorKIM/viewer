// Vercel Serverless Function — 유형1 DO6004(데이터 등록) 전송. 동작은 server/tp1-sf-log-runner.mjs 와 같음.
// 업체별로 최근 10분 동안 센서 데이터(InfluxDB)가 실제로 쌓였으면 그 업체 인증키로 1건, 없으면 보내지 않음.
// 10분 주기 실행은 회사 서버 작업(TP1 SF Log Runner)으로 하고, 이 API는 확인·수동 실행용.
//
// GET /api/tp1-sf-log?dry=1   전송 없이 최근 10분 센서 건수·바이트·전송 예정 내용만 반환 (화면 표시용)
// GET /api/tp1-sf-log?test=1  DO6999(테스트, 통계 제외)로 1건 전송해 키·형식 확인
// GET /api/tp1-sf-log         전송(데이터가 있을 때만 DO6004)
// CRON_SECRET 을 설정하면 dry 가 아닌 호출은 Authorization: Bearer <값> 이 있어야 함.

import { Client } from 'pg';
import { PG_CONFIG } from './_sf-send.js';
import { runTp1SfLog } from './_tp1.js';

export default async function handler(req, res) {
    const query = req.query || {};
    const dry = query.dry === '1';
    const test = !dry && query.test === '1';
    const secret = process.env.CRON_SECRET;
    if (!dry && secret && req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }
    if (!dry && !process.env.PG_PASSWORD) {
        res.status(500).json({ error: 'PG_PASSWORD 환경변수가 설정되지 않았습니다.' });
        return;
    }
    res.setHeader('Cache-Control', 'no-store');
    if (dry) {
        // 확인 모드는 DB를 쓰지 않음
        res.status(200).json(await runTp1SfLog(null, { dry: true }));
        return;
    }
    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        res.status(200).json(await runTp1SfLog(client, { test }));
    } catch (err) {
        res.status(500).json({ error: 'db_failed', message: String(err) });
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
}
