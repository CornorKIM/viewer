// Vercel Serverless Function — 웹 뷰어 로그인·로그아웃 + 스마트공장 로그(DO6001 로그인 / DO6002 로그아웃).
// 아이디 = 업체 이름(공백 무시), 비밀번호 = 장비 번호. 실제 로그인·로그아웃이 일어날 때만 그 업체 인증키로 1건 전송.
// 전송 결과는 송수신 이력(tp23.sf_log_history)에 저장.
//
// POST /api/sf-auth  JSON { action: 'login', id, password, test? } → { ok, set, id, token, log }
//                    JSON { action: 'logout', token, test? }        → { ok, set, id, log }
// test: true → DO6999(테스트, 통계 제외)로 전송. 뷰어 주소에 ?sftest=1 을 붙이면 test 로 호출.
// 세션 토큰 = 서버 비밀값(AUTH_SECRET, 없으면 PG_PASSWORD)으로 서명, 12시간 유효.

import crypto from 'node:crypto';
import { Client } from 'pg';
import { insertHistory } from './_sf-history.js';
import { describeResult } from './_sf-codes.js';
import { PG_CONFIG, USE_SE, SET_EQUIPMENT_NO, sfKey, kstLogDt, clientIp, sendSfLog } from './_sf-send.js';

const ACCOUNT_IDS = { A: '목공소 봄', B: '이레공방', C: '브랜드스미스', D: '비스트럭처' };
const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;

const normalize = (s) => String(s || '').replace(/\s+/g, '');
const secret = () => process.env.AUTH_SECRET || process.env.PG_PASSWORD || '';
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');

function makeToken(set) {
    const payload = b64url(JSON.stringify({ set, iat: Date.now() }));
    return `${payload}.${sign(payload)}`;
}

function readToken(token) {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (!ACCOUNT_IDS[data.set] || Date.now() - data.iat > TOKEN_TTL_MS) return null;
        return data;
    } catch {
        return null;
    }
}

function findAccount(id, password) {
    const set = Object.keys(ACCOUNT_IDS).find((s) => normalize(ACCOUNT_IDS[s]) === normalize(id));
    if (!set || String(password || '').trim() !== SET_EQUIPMENT_NO[set]) return null;
    return set;
}

// 로그 1건 전송 + 이력 저장. 키가 없거나 전송·저장이 실패해도 로그인·로그아웃 자체는 진행.
async function sendAuthLog(req, set, useSe, test) {
    const key = sfKey(set);
    const fields = {
        crtfcKey: key || '',
        logDt: kstLogDt(),
        useSe: test ? USE_SE.test : useSe,
        sysUser: ACCOUNT_IDS[set],
        conectIp: clientIp(req) || 'unknown',
        dataUsgqty: '0',
    };
    let response;
    let error;
    if (!key) error = 'missing_key';
    else {
        try { response = await sendSfLog(fields); } catch (err) { error = `send_failed: ${String(err)}`; }
    }
    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        await insertHistory(client, { set, equipmentNo: SET_EQUIPMENT_NO[set], test, fields, response, error });
    } catch {
        // 이력 저장 실패는 무시(로그인·로그아웃은 계속)
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
    return { use_se: fields.useSe, ...describeResult(response && response.code, error) };
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        res.status(405).json({ error: 'method_not_allowed' });
        return;
    }
    if (!secret()) {
        res.status(500).json({ error: 'no_secret', message: '서버 비밀값(AUTH_SECRET 또는 PG_PASSWORD)이 없습니다.' });
        return;
    }
    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch { body = {}; }
    }
    const test = body.test === true;

    if (body.action === 'login') {
        const set = findAccount(body.id, body.password);
        if (!set) {
            res.status(401).json({ ok: false, error: 'invalid_credentials', message: '아이디 또는 비밀번호가 맞지 않습니다.' });
            return;
        }
        const log = await sendAuthLog(req, set, USE_SE.login, test);
        res.status(200).json({ ok: true, set, id: ACCOUNT_IDS[set], token: makeToken(set), log });
        return;
    }

    if (body.action === 'logout') {
        const session = readToken(body.token);
        if (!session) {
            res.status(401).json({ ok: false, error: 'invalid_session', message: '로그인 정보가 없거나 만료되었습니다.' });
            return;
        }
        const log = await sendAuthLog(req, session.set, USE_SE.logout, test);
        res.status(200).json({ ok: true, set: session.set, id: ACCOUNT_IDS[session.set], log });
        return;
    }

    res.status(400).json({ error: 'invalid_action' });
}
