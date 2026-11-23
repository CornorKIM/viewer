// A small ESMTP client for interfaces/smtp-mail.md: STARTTLS is required before AUTH (never send
// credentials in clear text); any rejected recipient fails the whole mail before DATA.
import net from 'node:net';
import tls from 'node:tls';

const STEP_TIMEOUT_MS = 20_000;

export class SmtpError extends Error {}

function session(socket) {
    let sock = socket;
    let buf = '';
    let lines = [];
    let waiter = null;
    let failure = null;

    const onData = (chunk) => {
        buf += chunk.toString('utf8');
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i).replace(/\r$/, '');
            buf = buf.slice(i + 1);
            lines.push(line);
            if (/^\d{3}(?: |$)/.test(line)) {
                const reply = { code: Number(line.slice(0, 3)), lines };
                lines = [];
                if (waiter) { const w = waiter; waiter = null; w.ok(reply); }
            }
        }
    };
    const onFail = (err) => {
        failure = err instanceof Error ? err : new SmtpError(String(err));
        if (waiter) { const w = waiter; waiter = null; w.bad(failure); }
    };
    const attach = (s) => {
        s.on('data', onData);
        s.on('error', onFail);
        s.on('close', () => onFail(new SmtpError('메일 서버 연결이 끊겼다')));
        s.setTimeout(STEP_TIMEOUT_MS, () => { onFail(new SmtpError('메일 서버 응답 시간 초과')); s.destroy(); });
    };
    attach(sock);

    const read = () => new Promise((ok, bad) => {
        if (failure) return bad(failure);
        waiter = { ok, bad };
    });
    return {
        read,
        async cmd(line, expect, label = line.split(' ')[0]) {
            sock.write(`${line}\r\n`);
            const r = await read();
            if (!expect.includes(r.code)) throw new SmtpError(`${label} 거부: ${r.lines.at(-1)}`);
            return r;
        },
        write(data) { sock.write(data); },
        async startTls(servername) {
            sock.removeAllListeners('data');
            sock.removeAllListeners('error');
            sock.removeAllListeners('close');
            sock.setTimeout(0);
            const secure = await new Promise((ok, bad) => {
                const s = tls.connect({ socket: sock, servername }, () => { clearTimeout(t); ok(s); });
                const t = setTimeout(() => { s.destroy(); bad(new SmtpError('TLS 핸드셰이크 시간 초과')); }, STEP_TIMEOUT_MS);
                s.once('error', (err) => { clearTimeout(t); bad(err); });
            });
            secure.removeAllListeners('error');
            sock = secure;
            buf = '';
            lines = [];
            attach(sock);
        },
        close() { try { sock.end(); } catch { /* ignore */ } sock.destroy(); },
    };
}

function connect(host, port) {
    return new Promise((ok, bad) => {
        const s = net.connect({ host, port });
        const t = setTimeout(() => { s.destroy(); bad(new SmtpError('메일 서버 접속 시간 초과')); }, STEP_TIMEOUT_MS);
        s.once('connect', () => { clearTimeout(t); ok(s); });
        s.once('error', (err) => { clearTimeout(t); bad(new SmtpError(`메일 서버 접속 실패: ${err.code || err.message}`)); });
    });
}

const hasExt = (reply, name) => reply.lines.some((l) => l.slice(4).toUpperCase().split(' ')[0] === name);

/** Dot-stuffs and CRLF-normalises a message body for DATA. */
function dataBlock(message) {
    const body = message.replace(/\r?\n/g, '\r\n').split('\r\n').map((l) => (l.startsWith('.') ? `.${l}` : l)).join('\r\n');
    return `${body}\r\n.\r\n`;
}

/** Sends one message. Resolves when the server accepted DATA (250); rejects with SmtpError otherwise. */
export async function sendMail({ host, port, user, pass, from, to, message }) {
    const s = session(await connect(host, port));
    try {
        const greet = await s.read();
        if (greet.code !== 220) throw new SmtpError(`메일 서버 인사 거부: ${greet.lines.at(-1)}`);
        const ehlo = await s.cmd('EHLO sf-daily', [250], 'EHLO');
        if (!hasExt(ehlo, 'STARTTLS')) throw new SmtpError('메일 서버가 STARTTLS 를 지원하지 않는다');
        await s.cmd('STARTTLS', [220]);
        await s.startTls(host);
        await s.cmd('EHLO sf-daily', [250], 'EHLO');
        await s.cmd(`AUTH PLAIN ${Buffer.from(`\0${user}\0${pass}`, 'utf8').toString('base64')}`, [235], 'AUTH');
        await s.cmd(`MAIL FROM:<${from}>`, [250], 'MAIL FROM');
        for (const rcpt of to) await s.cmd(`RCPT TO:<${rcpt}>`, [250, 251], `RCPT TO ${rcpt}`);
        await s.cmd('DATA', [354]);
        s.write(dataBlock(message));
        const done = await s.read();
        if (done.code !== 250) throw new SmtpError(`DATA 거부: ${done.lines.at(-1)}`);
        await s.cmd('QUIT', [221]).catch(() => {});
    } finally { s.close(); }
}
