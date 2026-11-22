// Vercel Serverless Function — 유형1 로그인·로그아웃 화면(/tp1.html) + 사업관리시스템 로그(DO6001 로그인 / DO6002 로그아웃).
// 실제 로그인·로그아웃이 일어날 때만 해당 업체 인증키로 1건 전송, 결과는 tp1.sf_log_history 에 저장.
//
// POST /api/tp1-auth  JSON { action: 'login', id, password, test? } → { ok, code, name, token, log }
//                     JSON { action: 'logout', token, test? }        → { ok, code, name, log }
// test: true → DO6999(테스트, 통계 제외). 화면 주소에 ?sftest=1 을 붙이면 test 로 호출.
// 비밀번호 = 환경변수 TP1_PASSWORD_<코드>. 세션 토큰 = AUTH_SECRET(없으면 PG_PASSWORD)로 서명, 12시간 유효.
// 2-3 뷰어(/api/sf-auth) 토큰과는 서로 통하지 않음.

import crypto from 'node:crypto';
import { Client } from 'pg';
import { PG_CONFIG, USE_SE, clientIp } from './_sf-send.js';
import { TP1_COMPANIES, findCompany, tp1Password, sendTp1Log, insertTp1History } from './_tp1.js';

const TOKEN_TTL_MS = 12 * 60 * 60 * 1000;
const PROJECT = 'tp1';

const secret = () => process.env.AUTH_SECRET || process.env.PG_PASSWORD || '';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(`${PROJECT}.${payload}`).digest('base64url');

function makeToken(code) {
    const payload = Buffer.from(JSON.stringify({ p: PROJECT, code, iat: Date.now() })).toString('base64url');
    return `${payload}.${sign(payload)}`;
}

function readToken(token) {
    const [payload, sig] = String(token || '').split('.');
    if (!payload || !sig) return null;
    const expected = sign(payload);
    if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    try {
        const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
        if (data.p !== PROJECT || !TP1_COMPANIES[data.code] || Date.now() - data.iat > TOKEN_TTL_MS) return null;
        return data;
    } catch {
        return null;
    }
}

function passwordMatches(code, password) {
    const expected = tp1Password(code);
    if (!expected) return false;
    const a = Buffer.from(String(password || ''));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// 로그 1건 전송 + 이력 저장. 키가 없거나 전송·저장이 실패해도 로그인·로그아웃 자체는 진행.
async function sendAuthLog(req, code, source, useSe, test) {
    const sent = await sendTp1Log(code, { useSe, test, conectIp: clientIp(req), dataUsgqty: 0 });
    const client = new Client(PG_CONFIG);
    try {
        await client.connect();
        await insertTp1History(client, { code, source, test, fields: sent.fields, response: sent.response, error: sent.error });
    } catch {
        // 이력 저장 실패는 무시(로그인·로그아웃은 계속)
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
    return { use_se: sent.fields.useSe, ...sent.result };
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
    res.setHeader('Cache-Control', 'no-store');

    if (body.action === 'login') {
        const code = findCompany(body.id);
        if (!code || !passwordMatches(code, body.password)) {
            res.status(401).json({ ok: false, error: 'invalid_credentials', message: '아이디 또는 비밀번호가 맞지 않습니다.' });
            return;
        }
        const log = await sendAuthLog(req, code, 'login', USE_SE.login, test);
        res.status(200).json({ ok: true, code, name: TP1_COMPANIES[code].name, token: makeToken(code), log });
        return;
    }

    if (body.action === 'logout') {
        const session = readToken(body.token);
        if (!session) {
            res.status(401).json({ ok: false, error: 'invalid_session', message: '로그인 정보가 없거나 만료되었습니다.' });
            return;
        }
        const log = await sendAuthLog(req, session.code, 'logout', USE_SE.logout, test);
        res.status(200).json({ ok: true, code: session.code, name: TP1_COMPANIES[session.code].name, log });
        return;
    }

    res.status(400).json({ error: 'invalid_action' });
}
