// Minimal ESMTP server standing in for the mail server (interfaces/smtp-mail.md).
// Speaks EHLO · STARTTLS (test CA cert) · AUTH PLAIN/LOGIN · MAIL · RCPT · DATA · RSET · NOOP · QUIT.
// Records every session so gates can judge ordering (TLS before AUTH), credentials, sender,
// recipients and the raw message. Behaviour knobs are set with stub.set({...}).
import net from 'node:net';
import tls from 'node:tls';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { TLS_DIR } from './paths.js';

const DEFAULTS = {
    user: null, // expected SMTP_USER (null = accept any)
    pass: null, // expected SMTP_PASS (null = accept any)
    starttls: true, // advertise STARTTLS
    authFail: false, // reply 535 to every AUTH
    rejectRcpt: [], // addresses answered with 550
    dataReply: 250, // final reply code after DATA
};

export async function startSmtpStub({ port = 587, ...opts } = {}) {
    let cfg = { ...DEFAULTS, ...opts };
    const sessions = [];
    const messages = [];
    const secureContext = tls.createSecureContext({
        key: readFileSync(path.join(TLS_DIR, 'server.key')),
        cert: readFileSync(path.join(TLS_DIR, 'server.crt')),
    });
    const sockets = new Set();

    const server = net.createServer((raw) => {
        sockets.add(raw);
        raw.on('close', () => sockets.delete(raw));
        const s = { tls: false, events: [], auth: [], mailFrom: null, rcpts: [], accepted: [], startedAt: Date.now() };
        sessions.push(s);
        let sock = raw;
        let buf = Buffer.alloc(0);
        let mode = 'cmd'; // cmd | data | auth-plain | auth-login-user | auth-login-pass
        let loginUser = null;
        let dataChunks = [];
        const send = (line) => { if (!sock.destroyed) sock.write(`${line}\r\n`); };

        const onData = (chunk) => {
            buf = Buffer.concat([buf, chunk]);
            for (;;) {
                const i = buf.indexOf('\r\n');
                if (i < 0) break;
                const lineBuf = buf.subarray(0, i);
                buf = buf.subarray(i + 2);
                if (handle(lineBuf) === 'upgrade') return;
            }
        };

        const finishAuth = (user, pass, mech) => {
            s.auth.push({ mech, user, pass, tls: s.tls });
            s.events.push('AUTH');
            const ok = !cfg.authFail && (cfg.user === null || cfg.user === user) && (cfg.pass === null || cfg.pass === pass);
            if (ok) { s.authed = true; send('235 2.7.0 Accepted'); } else send('535 5.7.8 Username and Password not accepted');
        };

        const handle = (lineBuf) => {
            if (mode === 'data') {
                const line = lineBuf.toString('latin1');
                if (line === '.') {
                    mode = 'cmd';
                    const data = Buffer.concat(dataChunks);
                    dataChunks = [];
                    s.events.push('DATA_END');
                    if (cfg.dataReply === 250) {
                        messages.push({ from: s.mailFrom, rcpts: [...s.accepted], raw: data, session: s, at: Date.now() });
                        send('250 2.0.0 OK queued');
                    } else send(`${cfg.dataReply} 5.7.1 Message rejected`);
                    s.mailFrom = null; s.rcpts = []; s.accepted = [];
                    return;
                }
                const body = lineBuf[0] === 0x2e ? lineBuf.subarray(1) : lineBuf; // dot-unstuffing
                dataChunks.push(body, Buffer.from('\r\n'));
                return;
            }
            const line = lineBuf.toString('utf8');
            if (mode === 'auth-plain') {
                mode = 'cmd';
                const [, u, p] = Buffer.from(line, 'base64').toString('utf8').split('\u0000');
                return finishAuth(u, p, 'PLAIN');
            }
            if (mode === 'auth-login-user') { loginUser = Buffer.from(line, 'base64').toString('utf8'); mode = 'auth-login-pass'; return send('334 UGFzc3dvcmQ6'); }
            if (mode === 'auth-login-pass') { mode = 'cmd'; return finishAuth(loginUser, Buffer.from(line, 'base64').toString('utf8'), 'LOGIN'); }

            const [verbRaw, ...rest] = line.split(' ');
            const verb = verbRaw.toUpperCase();
            const arg = rest.join(' ');
            if (verb === 'EHLO' || verb === 'HELO') {
                s.events.push('EHLO');
                const ext = [];
                if (cfg.starttls && !s.tls) ext.push('STARTTLS');
                if (s.tls || !cfg.starttls) ext.push('AUTH PLAIN LOGIN');
                ext.push('8BITMIME', 'SMTPUTF8', 'SIZE 35882577');
                if (verb === 'HELO') return send('250 smtp.test');
                send('250-smtp.test at your service');
                ext.forEach((e, i) => send(`250${i === ext.length - 1 ? ' ' : '-'}${e}`));
                return;
            }
            if (verb === 'STARTTLS') {
                if (!cfg.starttls || s.tls) return send('502 5.5.1 Unrecognized command');
                s.events.push('STARTTLS');
                send('220 2.0.0 Ready to start TLS');
                sock.removeListener('data', onData);
                const secure = new tls.TLSSocket(sock, { isServer: true, secureContext });
                secure.on('secure', () => { s.tls = true; });
                secure.on('error', () => {});
                secure.on('data', onData);
                sock = secure;
                buf = Buffer.alloc(0);
                return 'upgrade';
            }
            if (verb === 'AUTH') {
                if (cfg.starttls && !s.tls) { s.auth.push({ mech: 'refused-plaintext', tls: false }); return send('530 5.7.0 Must issue a STARTTLS command first'); }
                const [mech, initial] = arg.split(' ');
                if (mech.toUpperCase() === 'PLAIN') {
                    if (initial) { const [, u, p] = Buffer.from(initial, 'base64').toString('utf8').split('\u0000'); return finishAuth(u, p, 'PLAIN'); }
                    mode = 'auth-plain'; return send('334 ');
                }
                if (mech.toUpperCase() === 'LOGIN') {
                    if (initial) { loginUser = Buffer.from(initial, 'base64').toString('utf8'); mode = 'auth-login-pass'; return send('334 UGFzc3dvcmQ6'); }
                    mode = 'auth-login-user'; return send('334 VXNlcm5hbWU6');
                }
                return send('504 5.5.4 Unrecognized authentication type');
            }
            if (verb === 'MAIL') {
                if (!s.authed) return send('530 5.7.0 Authentication Required');
                s.events.push('MAIL');
                s.mailFrom = (arg.match(/<([^>]*)>/) || [])[1] ?? null;
                return send('250 2.1.0 OK');
            }
            if (verb === 'RCPT') {
                const addr = ((arg.match(/<([^>]*)>/) || [])[1] ?? '').toLowerCase();
                s.events.push('RCPT');
                s.rcpts.push(addr);
                if (cfg.rejectRcpt.map((x) => x.toLowerCase()).includes(addr)) return send('550 5.1.1 No such user');
                s.accepted.push(addr);
                return send('250 2.1.5 OK');
            }
            if (verb === 'DATA') {
                if (!s.mailFrom || s.accepted.length === 0) return send('554 5.5.1 No valid recipients');
                s.events.push('DATA');
                mode = 'data';
                return send('354 Go ahead');
            }
            if (verb === 'RSET') { s.mailFrom = null; s.rcpts = []; s.accepted = []; return send('250 2.1.5 Flushed'); }
            if (verb === 'NOOP') return send('250 2.0.0 OK');
            if (verb === 'QUIT') { s.events.push('QUIT'); send('221 2.0.0 closing connection'); return sock.end(); }
            return send('502 5.5.1 Unrecognized command');
        };

        raw.on('data', onData);
        raw.on('error', () => {});
        send('220 smtp.test ESMTP gate stub');
    });

    await new Promise((ok, bad) => { server.once('error', bad); server.listen(port, '127.0.0.1', ok); });
    return {
        port,
        sessions,
        messages,
        set(opts) { cfg = { ...cfg, ...opts }; },
        reset() { cfg = { ...DEFAULTS, ...opts }; sessions.length = 0; messages.length = 0; },
        async close() { await new Promise((ok) => { server.close(() => ok()); for (const s of sockets) s.destroy(); }); },
    };
}
