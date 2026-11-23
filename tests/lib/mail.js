// Status-mail helpers: seeding normal-save counts for a date, and reading a received mail.
import { before, after, beforeEach } from 'node:test';
import { applyBaseEnv } from './env.js';
import { startSmtpStub } from './smtp-stub.js';
import { resetHistory, clearDedicated, insertHistory, closeDb } from './db.js';
import { parseMessage } from './mime.js';
import { tableRows, textBeforeTable, visibleText, redClasses, markupIsRed } from './html.js';
import { kstAt } from './kst.js';
import { ROSTER, byCode } from './roster.js';
import { SMTP } from './env.js';

export function useMailWorld(envExtra = {}) {
    const ctx = { smtp: null };
    applyBaseEnv(envExtra);
    before(async () => { ctx.smtp = await startSmtpStub({ user: SMTP.user, pass: SMTP.pass }); });
    after(async () => { await ctx.smtp.close(); await closeDb(); });
    beforeEach(async () => { ctx.smtp.reset(); await resetHistory(); await clearDedicated(); });
    return ctx;
}

/** counts: { A: [login, query, logout], … } → that many AP1002 rows on KST date `date`. */
export async function seedCounts(date, counts) {
    let s = 0;
    for (const [code, triple] of Object.entries(counts)) {
        const useSes = ['DO6001', 'DO6003', 'DO6002'];
        for (let i = 0; i < 3; i++) {
            for (let k = 0; k < triple[i]; k++) {
                s++;
                await insertHistory(code, { useSe: useSes[i], sentAt: new Date(+kstAt(date, '12:00:00') + s * 1000) });
            }
        }
    }
}

export function viewMail(message) {
    const p = parseMessage(message.raw);
    const html = p.html;
    const rows = tableRows(html);
    const header = rows.find((r) => r.cells.some((c) => c.includes('로그인')) && r.cells.some((c) => c.includes('조회')) && r.cells.some((c) => c.includes('로그아웃')));
    const col = header ? {
        login: header.cells.findIndex((c) => c.includes('로그인') && !c.includes('로그아웃')),
        query: header.cells.findIndex((c) => c.includes('조회')),
        logout: header.cells.findIndex((c) => c.includes('로그아웃')),
    } : null;
    const classes = redClasses(html);
    const rowOf = (code) => rows.find((r) => r !== header && r.text.includes(byCode(code).name));
    return {
        parsed: p,
        subject: p.subject,
        html,
        rows,
        header,
        top: textBeforeTable(html),
        visible: visibleText(html),
        rowOf,
        counts(code) {
            const r = rowOf(code);
            if (!r || !col) return null;
            return [col.login, col.query, col.logout].map((i) => (r.cells[i] ?? '').trim());
        },
        isRed(code) { const r = rowOf(code); return r ? markupIsRed(r.markup, classes) : null; },
        companyOrder() { return ROSTER.map((c) => rows.indexOf(rowOf(c.code))); },
    };
}
