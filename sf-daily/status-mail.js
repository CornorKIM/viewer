// status-mail (docs/spec/sf-daily/spec/status-mail.md · api/status-mail.md):
// one mail per day with each company's normal-save counts per step; login 0 is flagged in red.
import { randomUUID } from 'node:crypto';
import { assertDateString } from './kst.js';
import { COMPANIES, STEPS } from './companies.js';
import { normalSaveCounts } from './history.js';
import { inDedicatedTx, LOCK } from './db.js';
import { sendMail } from './smtp.js';

export const DEFAULT_REPORT_LINK = 'https://twin.smartline.kr/sflog.html';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const recipients = (v = process.env.SF_REPORT_TO) => String(v ?? '').split(',').map((s) => s.trim()).filter(Boolean);

function mailConfig() {
    const port = Number(String(process.env.SMTP_PORT ?? '').trim() || 587);
    return {
        host: String(process.env.SMTP_HOST ?? '').trim(),
        port,
        user: String(process.env.SMTP_USER ?? '').trim(),
        pass: String(process.env.SMTP_PASS ?? ''),
        to: recipients(),
        link: String(process.env.SF_REPORT_LINK ?? '').trim() || DEFAULT_REPORT_LINK,
    };
}

/** rows: [{ company, counts: { login, query, logout } }] */
export function buildReport(date, rows, link) {
    const missing = rows.filter((r) => r.counts.login === 0);
    const subject = `${missing.length ? '[로그인 누락] ' : ''}스마트공장 로그 현황 ${date}`;
    const top = missing.length
        ? `<p style="color:#d00000;font-weight:bold">수동 로그인 필요: ${missing.map((r) => esc(r.company.name)).join(', ')}</p>`
        : '<p>모든 업체 로그인 정상</p>';
    const head = `<tr><th>업체</th><th>유형</th>${STEPS.map((s) => `<th>${s.name}</th>`).join('')}</tr>`;
    const body = rows.map((r) => {
        const red = r.counts.login === 0;
        const cell = (v) => `<td${red ? ' style="color:#d00000"' : ''}>${esc(v)}</td>`;
        return `<tr${red ? ' style="color:#d00000;font-weight:bold"' : ''}>${cell(r.company.name)}${cell(r.company.type)}${STEPS.map((s) => cell(r.counts[s.step])).join('')}</tr>`;
    }).join('\n');
    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${esc(subject)}</title></head>
<body>
${top}
<p>${esc(date)} 업체별 정상 저장(AP1002) 건수</p>
<table border="1" cellpadding="6" cellspacing="0">
${head}
${body}
</table>
<p>전송 이력: <a href="${esc(link)}">${esc(link)}</a></p>
</body></html>`;
    const text = [
        missing.length ? `수동 로그인 필요: ${missing.map((r) => r.company.name).join(', ')}` : '모든 업체 로그인 정상',
        '',
        `${date} 업체별 정상 저장(AP1002) 건수 — 로그인 / 조회 / 로그아웃`,
        ...rows.map((r) => `${r.company.name} (${r.company.type}): ${r.counts.login} / ${r.counts.query} / ${r.counts.logout}`),
        '',
        `전송 이력: ${link}`,
    ].join('\n');
    return { subject, html, text, missingLogin: missing.map((r) => r.company.code) };
}

/** RFC 2047 encoded words, split on character boundaries so each stays short. */
function encodeHeader(s) {
    if (/^[\x20-\x7e]*$/.test(s)) return s;
    const words = [];
    let cur = '';
    for (const ch of s) {
        if (Buffer.byteLength(cur + ch, 'utf8') > 42) { words.push(cur); cur = ''; }
        cur += ch;
    }
    if (cur) words.push(cur);
    return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64').replace(/.{1,76}/g, '$&\r\n').trimEnd();

function mimeMessage({ from, to, subject, html, text }) {
    const boundary = `sfdaily-${randomUUID()}`;
    const domain = from.split('@')[1] || 'sf-daily';
    return [
        `From: ${from}`,
        `To: ${to.join(', ')}`,
        `Subject: ${encodeHeader(subject)}`,
        `Date: ${new Date().toUTCString().replace('GMT', '+0000')}`,
        `Message-ID: <${randomUUID()}@${domain}>`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/alternative; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(text),
        `--${boundary}`,
        'Content-Type: text/html; charset=utf-8',
        'Content-Transfer-Encoding: base64',
        '',
        b64(html),
        `--${boundary}--`,
        '',
    ].join('\r\n');
}

const failed = (err, missingLogin = []) => ({ outcome: 'failed', missingLogin, error: String(err?.message ?? err) || '실패' });

/** sendStatusMail('YYYY-MM-DD') → { outcome: sent|already_sent|failed, missingLogin, error } */
export async function sendStatusMail(date) {
    assertDateString(date);
    const cfg = mailConfig();
    let missingLogin = [];
    try {
        return await inDedicatedTx(async (c) => {
            // Callers for the same date queue here; whoever comes after a sent mail sees the record.
            await c.query('SELECT pg_advisory_xact_lock($1, hashtext($2))', [LOCK.mail, date]);
            const done = await c.query('SELECT 1 FROM sf_daily_mail WHERE mail_date = $1', [date]);
            if (done.rowCount) return { outcome: 'already_sent', missingLogin: [], error: null };
            const counts = await normalSaveCounts(COMPANIES, date);
            const rows = COMPANIES.map((co) => ({
                company: co,
                counts: Object.fromEntries(STEPS.map((s) => [s.step, counts[co.code][s.useSe] ?? 0])),
            }));
            const report = buildReport(date, rows, cfg.link);
            missingLogin = report.missingLogin;
            if (!cfg.host || !cfg.user || !cfg.pass || !cfg.to.length) throw new Error('메일 설정(SMTP_HOST · SMTP_USER · SMTP_PASS · SF_REPORT_TO)이 비어 있다');
            await sendMail({
                host: cfg.host, port: cfg.port, user: cfg.user, pass: cfg.pass, from: cfg.user, to: cfg.to,
                message: mimeMessage({ from: cfg.user, to: cfg.to, subject: report.subject, html: report.html, text: report.text }),
            });
            await c.query('INSERT INTO sf_daily_mail (mail_date) VALUES ($1) ON CONFLICT DO NOTHING', [date]);
            return { outcome: 'sent', missingLogin: report.missingLogin, error: null };
        });
    } catch (err) {
        const f = failed(err, missingLogin);
        if (cfg.pass && f.error.includes(cfg.pass)) f.error = f.error.split(cfg.pass).join('***');
        return f;
    }
}
