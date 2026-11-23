// Runs before any gate. Proves the harness is isolated and its stubs work, so a red gate means
// "the implementation does not hold the proposition", not "the harness is broken".
// Exit 3 (no gates run) if any check fails.
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { history, dedicated, closeDb } from './db.js';
import { startFakeInternet, LOG_HOST, LOG_PATH, CAL_HOST, CAL_PATH } from './fake-internet.js';
import { startSmtpStub } from './smtp-stub.js';
import { parseMessage } from './mime.js';
import { TLS_DIR } from './paths.js';

const checks = [];
const check = (name, fn) => checks.push([name, fn]);

function tcpRefusedOrTimeout(host, port, ms = 2500) {
    return new Promise((ok) => {
        const s = net.connect({ host, port });
        const done = (reachable) => { s.destroy(); ok(!reachable); };
        s.setTimeout(ms, () => done(false));
        s.on('connect', () => done(true));
        s.on('error', () => done(false));
    });
}

check('real host names resolve to the local stubs', async () => {
    for (const h of [LOG_HOST, CAL_HOST, 'smtp.test']) {
        const { address } = await dns.lookup(h, { family: 4 });
        if (address !== '127.0.0.1') throw new Error(`${h} → ${address}`);
    }
});
check('no route out (internet, Windows PostgreSQL)', async () => {
    for (const [h, p] of [['1.1.1.1', 443], ['8.8.8.8', 53], ['175.193.55.102', 5432], ['175.193.55.102', 443]]) {
        if (!(await tcpRefusedOrTimeout(h, p))) throw new Error(`${h}:${p} is reachable`);
    }
});
check('test PostgreSQL: history tables, dedicated DB, Asia/Seoul', async () => {
    const t = await history().query(`SELECT count(*)::int AS n FROM information_schema.tables
        WHERE (table_schema, table_name) IN (('tp23','sf_log_history'),('tp1','sf_log_history'))`);
    if (t.rows[0].n !== 2) throw new Error('history tables missing');
    const z = await history().query(`SELECT to_char(timestamptz '2026-01-01 15:30:00+00' AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD HH24:MI') AS v`);
    if (z.rows[0].v !== '2026-01-02 00:30') throw new Error(`Asia/Seoul conversion gave ${z.rows[0].v}`);
    const d = await dedicated().query('SELECT current_database() AS db');
    if (d.rows[0].db !== 'sfdaily') throw new Error(`SF_DB_URL points at ${d.rows[0].db}`);
    if (process.env.PG_HOST === '175.193.55.102') throw new Error('PG_HOST is the shared Windows PostgreSQL');
});
check('fake internet over the contract URLs with the test CA', async () => {
    const fake = await startFakeInternet();
    try {
        const r = await fetch(`https://${LOG_HOST}${LOG_PATH}`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded; charset=UTF-8' }, body: 'crtfcKey=x&useSe=DO6999' });
        const j = await r.json();
        if (j.result.recptnRsltCd !== 'AP1002' || fake.log.requests[0].fields.useSe !== 'DO6999') throw new Error('log stub reply/record wrong');
        const c = await fetch(`https://${CAL_HOST}${CAL_PATH}`);
        if (!(await c.text()).startsWith('BEGIN:VCALENDAR') || fake.calendar.requests[0].url !== CAL_PATH) throw new Error('calendar stub wrong');
    } finally { await fake.stop(); }
});
check('SMTP stub: STARTTLS, AUTH, DATA, MIME decode', async () => {
    const stub = await startSmtpStub({ port: 2599, user: 'u@smtp.test', pass: 'p' });
    try {
        await miniSend(2599);
        const m = stub.messages[0];
        if (!m) throw new Error('no message recorded');
        const s = m.session;
        if (!s.auth[0]?.tls || s.auth[0].user !== 'u@smtp.test' || s.events.indexOf('STARTTLS') > s.events.indexOf('AUTH')) throw new Error('session order wrong');
        const p = parseMessage(m.raw);
        if (p.subject !== '[점검] 스마트공장 로그 현황') throw new Error(`subject decoded as ${p.subject}`);
        if (!p.html.includes('<td style="color:red">목공소 봄</td>')) throw new Error('html part not decoded');
    } finally { await stub.close(); }
});

function miniSend(port) {
    // A deliberately tiny SMTP client (STARTTLS + AUTH PLAIN + a base64 HTML part) to exercise the stub.
    return new Promise((ok, bad) => {
        let sock = net.connect({ host: '127.0.0.1', port });
        const subject = `=?UTF-8?B?${Buffer.from('[점검] 스마트공장').toString('base64')}?= =?UTF-8?Q?_=EB=A1=9C=EA=B7=B8_=ED=98=84=ED=99=A9?=`;
        const html = Buffer.from('<table><tr><td style="color:red">목공소 봄</td></tr></table>').toString('base64');
        const data = [`Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: multipart/alternative; boundary="b1"', '', '--b1',
            'Content-Type: text/plain; charset=utf-8', '', 'plain', '--b1', 'Content-Type: text/html; charset=utf-8',
            'Content-Transfer-Encoding: base64', '', html, '--b1--', '.'].join('\r\n');
        const script = [
            [/^220 /, 'EHLO gate'], [/^250 /, 'STARTTLS'], [/^220 /, 'TLS'], [/^250 /, `AUTH PLAIN ${Buffer.from('\0u@smtp.test\0p').toString('base64')}`],
            [/^235 /, 'MAIL FROM:<u@smtp.test>'], [/^250 /, 'RCPT TO:<x@example.test>'], [/^250 /, 'DATA'], [/^354 /, data], [/^250 /, 'QUIT'], [/^221 /, null],
        ];
        let buf = '';
        const onData = (b) => {
            buf += b.toString('utf8');
            let i;
            while ((i = buf.indexOf('\r\n')) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 2);
                if (/^\d{3}-/.test(line)) continue;
                const [re, next] = script.shift();
                if (!re.test(line)) return bad(new Error(`unexpected ${line}`));
                if (next === null) { sock.end(); return ok(); }
                if (next === 'TLS') {
                    sock.removeListener('data', onData);
                    sock = tls.connect({ socket: sock, servername: 'smtp.test', ca: readFileSync(path.join(TLS_DIR, 'ca.crt')) }, () => sock.write('EHLO gate\r\n'));
                    sock.on('data', onData); sock.on('error', bad);
                    return;
                }
                sock.write(`${next}\r\n`);
            }
        };
        sock.on('data', onData);
        sock.on('error', bad);
    });
}

let failed = 0;
for (const [name, fn] of checks) {
    try { await fn(); console.log(`preflight ok   ${name}`); } catch (err) { failed++; console.log(`preflight FAIL ${name}: ${err.message}`); }
}
await closeDb();
if (failed) { console.log('preflight: harness not safe or not working — no gates run'); process.exit(3); }
console.log('preflight: isolated, stubs answer — running gates');
