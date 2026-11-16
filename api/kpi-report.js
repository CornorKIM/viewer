// Vercel Serverless Function — 핵심성과지표 일일 보고 메일.
// Vercel Cron(vercel.json)이 매일 00:00 UTC(= 09:00 KST)에 호출 → 그날 4개사 KPI가 구축 후 값에
// 도달하는 시각을 계산해, 마지막 도달 시각에 메일이 발송되도록 Resend에 예약한다.
// 주말·공휴일(kpi.js KR_HOLIDAYS)은 발송하지 않음.
//
// 환경변수(Vercel):
// - RESEND_API_KEY   (필수) Resend API 키
// - KPI_REPORT_TO    (필수) 받는 사람. 쉼표로 여러 명
// - KPI_REPORT_FROM  (선택) 보내는 사람. 기본 'TP_2-3 KPI <onboarding@resend.dev>'
//                    (onboarding@resend.dev 는 Resend 가입 메일 주소로만 발송 가능)
// - CRON_SECRET      (권장) 설정하면 Vercel Cron 외의 호출을 막음
//
// 수동 확인: GET /api/kpi-report?dry=1[&date=YYYY-MM-DD] → 발송하지 않고 내용·예약 시각만 반환.

import {
    SET_KPI, kpiImprovement, kpiReachMin, kstDate, kstParts, formatKstMin, isKpiWorkday,
} from '../kpi.js';

const SET_NAMES = { A: '목공소 봄', B: '이레공방', C: '브랜드스미스', D: '비스트럭처' };
const SETS = ['A', 'B', 'C', 'D'];
const DEFAULT_FROM = 'TP_2-3 KPI <onboarding@resend.dev>';
const MIN_SCHEDULE_LEAD_MS = 60 * 1000; // 이보다 가까우면 예약 없이 즉시 발송

const fmtNum = (v) => String(Number(v.toFixed(2)));
const fmtPct = (v) => `${v.toFixed(2)}%`;
const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildReport(dateKey) {
    const rows = SETS.map((set) => {
        const { product, items } = SET_KPI[set];
        const reach = kpiReachMin(set, dateKey);
        const indicators = items.map((item) => ({
            label: `${item.code} ${item.name}(${item.unit})`,
            before: item.before, target: item.target, after: item.after,
            rate: kpiImprovement(item, item.after),
        }));
        const total = items.reduce((sum, item, i) => sum + indicators[i].rate * item.weight, 0);
        return { set, name: SET_NAMES[set], product, reach, indicators, total };
    });
    const sendMin = Math.max(...rows.map((r) => r.reach));
    const subject = `[TP_2-3] 핵심성과지표 일일 보고 ${dateKey}`;

    const text = [
        `${subject}`,
        '',
        ...rows.flatMap((r) => [
            `■ ${r.name} (${r.product}) — 도달 ${formatKstMin(r.reach)}, 종합 개선율 ${fmtPct(r.total)}`,
            ...r.indicators.map((k) => `  - ${k.label}: 구축 전 ${fmtNum(k.before)} / 목표 ${fmtNum(k.target)} / 구축 후 ${fmtNum(k.after)} / 개선율 ${fmtPct(k.rate)}`),
        ]),
    ].join('\n');

    const th = 'style="border:1px solid #ccc;padding:4px 8px;background:#f3f3f3;text-align:center"';
    const td = 'style="border:1px solid #ccc;padding:4px 8px;text-align:right"';
    const tdl = 'style="border:1px solid #ccc;padding:4px 8px;text-align:left"';
    const html = `
<div style="font-family:sans-serif;font-size:13px">
  <h3 style="margin:0 0 8px">${escapeHtml(subject)}</h3>
  <table style="border-collapse:collapse">
    <tr><th ${th}>업체</th><th ${th}>기준 제품</th><th ${th}>지표</th><th ${th}>구축 전</th><th ${th}>목표</th><th ${th}>구축 후</th><th ${th}>개선율</th><th ${th}>종합</th><th ${th}>도달 시각</th></tr>
    ${rows.map((r) => r.indicators.map((k, i) => `<tr>
      ${i === 0 ? `<td ${tdl} rowspan="${r.indicators.length}">${escapeHtml(r.name)}</td><td ${tdl} rowspan="${r.indicators.length}">${escapeHtml(r.product)}</td>` : ''}
      <td ${tdl}>${escapeHtml(k.label)}</td><td ${td}>${fmtNum(k.before)}</td><td ${td}>${fmtNum(k.target)}</td><td ${td}>${fmtNum(k.after)}</td><td ${td}>${fmtPct(k.rate)}</td>
      ${i === 0 ? `<td ${td} rowspan="${r.indicators.length}"><b>${fmtPct(r.total)}</b></td><td ${td} rowspan="${r.indicators.length}">${formatKstMin(r.reach)}</td>` : ''}
    </tr>`).join('')).join('')}
  </table>
</div>`;

    return { subject, text, html, sendAt: kstDate(dateKey, sendMin), rows };
}

export default async function handler(req, res) {
    const secret = process.env.CRON_SECRET;
    if (secret && req.headers.authorization !== `Bearer ${secret}`) {
        res.status(401).json({ error: 'unauthorized' });
        return;
    }

    const query = req.query || {};
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : kstParts(new Date()).dateKey;
    const dry = query.dry === '1';

    if (!isKpiWorkday(dateKey)) {
        res.status(200).json({ date: dateKey, skipped: 'not_a_workday' });
        return;
    }

    const report = buildReport(dateKey);
    const now = Date.now();
    const scheduleAt = report.sendAt.getTime() - now > MIN_SCHEDULE_LEAD_MS ? report.sendAt.toISOString() : null;
    const summary = {
        date: dateKey,
        send_at_kst: `${dateKey} ${formatKstMin(kstParts(report.sendAt).min)}`,
        scheduled_at: scheduleAt,
        reach_kst: Object.fromEntries(report.rows.map((r) => [r.name, formatKstMin(r.reach)])),
        subject: report.subject,
    };

    if (dry) {
        res.status(200).json({ ...summary, dry: true, text: report.text });
        return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    const to = String(process.env.KPI_REPORT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!apiKey || to.length === 0) {
        res.status(500).json({ error: 'missing_env', message: 'RESEND_API_KEY, KPI_REPORT_TO 환경변수가 필요합니다.' });
        return;
    }

    try {
        const r = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                'Idempotency-Key': `tp23-kpi-report-${dateKey}`,
            },
            body: JSON.stringify({
                from: process.env.KPI_REPORT_FROM || DEFAULT_FROM,
                to,
                subject: report.subject,
                html: report.html,
                text: report.text,
                ...(scheduleAt ? { scheduled_at: scheduleAt } : {}),
            }),
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            res.status(502).json({ ...summary, error: 'send_failed', status: r.status, detail: data });
            return;
        }
        res.status(200).json({ ...summary, id: data.id });
    } catch (err) {
        res.status(502).json({ ...summary, error: 'send_failed', message: String(err) });
    }
}
