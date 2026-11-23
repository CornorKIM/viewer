// In-process HTTPS stand-in for the two real hosts the contracts fix by URL:
//   log.smart-factory.kr  (POST /apisvc/sendLogData.json)  and  calendar.google.com (GET …/basic.ics).
// The harness pins both names to 127.0.0.1 and trusts tests/lib/tls/ca.crt via NODE_EXTRA_CA_CERTS,
// so the implementation keeps the contract URLs and still only ever talks to this stub.
// Also a plain-HTTP stub on an ephemeral port for SF_HOLIDAY_CALENDAR_URL overrides.
import https from 'node:https';
import http from 'node:http';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TLS_DIR } from './paths.js';
import { ical } from './ical.js';

export const LOG_HOST = 'log.smart-factory.kr';
export const LOG_PATH = '/apisvc/sendLogData.json';
export const CAL_HOST = 'calendar.google.com';
export const CAL_PATH = '/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics';

export function logReply(code = 'AP1002', { nested = true, msg } = {}) {
    const result = { recptnRsltCd: code, recptnRslt: msg ?? (code === 'AP1002' ? '정상 저장' : `오류 ${code}`), recptnRsltDtl: '', recptnDt: '2026-01-01 00:00:00' };
    return { status: 200, headers: { 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(nested ? { result } : result) };
}

function makeEndpoint(defaultRespond) {
    const ep = {
        requests: [],
        respond: defaultRespond,
        reset() { ep.requests.length = 0; ep.respond = defaultRespond; },
    };
    return ep;
}

async function serve(ep, req, res, body) {
    const rec = { at: Date.now(), method: req.method, url: req.url, host: (req.headers.host || '').replace(/:\d+$/, ''), headers: req.headers, body };
    if (req.method === 'POST' && /x-www-form-urlencoded/i.test(req.headers['content-type'] || '')) {
        rec.fields = Object.fromEntries(new URLSearchParams(body));
    }
    ep.requests.push(rec);
    const r = (await ep.respond(rec)) || { status: 200, body: '' };
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
    if (r.destroy) { req.socket.destroy(); return; }
    if (res.destroyed) return;
    // No keep-alive: a stub restart must never leave clients holding a dead pooled socket.
    res.writeHead(r.status ?? 200, { ...(r.headers || {}), connection: 'close' });
    res.end(r.body ?? '');
}

function readBody(req) {
    return new Promise((ok) => { const c = []; req.on('data', (b) => c.push(b)); req.on('end', () => ok(Buffer.concat(c).toString('utf8'))); });
}

function trackSockets(server) {
    const sockets = new Set();
    server.on('connection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    server.on('secureConnection', (s) => { sockets.add(s); s.on('close', () => sockets.delete(s)); });
    return () => { for (const s of sockets) s.destroy(); };
}

export async function startFakeInternet({ port = 443 } = {}) {
    const log = makeEndpoint(() => logReply('AP1002'));
    const calendar = makeEndpoint(() => ({ status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' }, body: ical() }));
    const tls = { key: readFileSync(path.join(TLS_DIR, 'server.key')), cert: readFileSync(path.join(TLS_DIR, 'server.crt')) };
    let server = null;
    let kill = () => {};
    const handler = async (req, res) => {
        const body = await readBody(req);
        const host = (req.headers.host || '').replace(/:\d+$/, '');
        if (host === LOG_HOST) return serve(log, req, res, body);
        if (host === CAL_HOST) return serve(calendar, req, res, body);
        res.writeHead(421); res.end('unknown host');
    };
    const fake = {
        log,
        calendar,
        reset() { log.reset(); calendar.reset(); },
        async start() {
            if (server) return;
            server = https.createServer(tls, handler);
            kill = trackSockets(server);
            await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
        },
        /** Stop listening: connections to the real host names are then refused. */
        async stop() {
            if (!server) return;
            const s = server; server = null;
            await new Promise((ok) => { s.close(() => ok()); kill(); });
        },
    };
    await fake.start();
    return fake;
}

/** Plain HTTP calendar stub on an ephemeral port. url = full URL to hand to SF_HOLIDAY_CALENDAR_URL; endpoint.requests records GETs. */
export async function startHttpCalendar(body = ical()) {
    const ep = makeEndpoint(() => ({ status: 200, headers: { 'content-type': 'text/calendar; charset=utf-8' }, body }));
    const server = http.createServer(async (req, res) => serve(ep, req, res, await readBody(req)));
    const kill = trackSockets(server);
    await new Promise((ok) => server.listen(0, '127.0.0.1', ok));
    const { port } = server.address();
    return { endpoint: ep, url: `http://127.0.0.1:${port}/gate/holidays.ics`, async close() { await new Promise((ok) => { server.close(() => ok()); kill(); }); } };
}
