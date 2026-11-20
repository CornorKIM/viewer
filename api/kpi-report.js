// Vercel Serverless Function — 핵심성과지표 일일 보고 메일.
// GitHub Actions(.github/workflows/kpi-report.yml)가 평일 16:00~19:50 KST에 10분마다 호출.
// 그날 4개사 중 마지막 업체가 구축 후 값에 도달한 시각이 지난 뒤 첫 호출에서 즉시 발송하고,
// 이후 호출은 같은 날 중복 방지 키(Resend Idempotency-Key)로 다시 보내지 않음.
// (Resend 예약 발송은 미인증 도메인 onboarding@resend.dev 로는 실패하므로 사용하지 않음)
// 주말·공휴일(kpi.js KR_HOLIDAYS)은 발송하지 않음.
//
// 환경변수(Vercel):
// - RESEND_API_KEY   (필수) Resend API 키
// - KPI_REPORT_TO    (필수) 받는 사람. 쉼표로 여러 명
// - KPI_REPORT_FROM  (선택) 보내는 사람. 기본 'TP_2-3 KPI <onboarding@resend.dev>'
//                    (onboarding@resend.dev 는 Resend 가입 메일 주소로만 발송 가능)
// - CRON_SECRET      (선택) 설정하면 Authorization: Bearer <값> 없는 호출을 막음. 없어도 실제 발송은 오늘 날짜만·하루 1통
//
// 수동 확인: GET /api/kpi-report?dry=1[&date=YYYY-MM-DD] → 발송하지 않고 내용·발송 시각만 반환.
// 테스트 발송: GET /api/kpi-report?test=1 → 오늘 내용을 제목 앞 [테스트]로 즉시 발송(하루 1통).

import { Client } from 'pg';
import {
    SET_KPI, kpiImprovement, kpiReachMin, kstDate, kstParts, formatKstMin, isKpiWorkday,
} from '../kpi.js';
import { ensureHistoryTable } from './_sf-history.js';
import { describeResult, SF_ERROR_FILTER_SQL } from './_sf-codes.js';

const SET_NAMES = { A: '목공소 봄', B: '이레공방', C: '브랜드스미스', D: '비스트럭처' };
const SETS = ['A', 'B', 'C', 'D'];
const DEFAULT_FROM = 'TP_2-3 KPI <onboarding@resend.dev>';

const fmtNum = (v) => String(Number(v.toFixed(2)));
const fmtPct = (v) => `${v.toFixed(2)}%`;
// 그날(KST) 스마트공장 로그 전송 요약(tp23.sf_log_history). DB를 못 읽으면 null → 메일에서 해당 부분 생략
const LOG_SUMMARY_SQL = `
SELECT set_code,
       count(*)::int                                              AS sent,
       count(*) FILTER (WHERE result_code = 'AP1002')::int        AS ok,
       count(*) FILTER (WHERE test)::int                          AS tests,
       count(*) FILTER (WHERE ${SF_ERROR_FILTER_SQL})::int         AS errors,
       (array_agg(result_code ORDER BY sent_at DESC))[1]          AS last_code,
       (array_agg(error ORDER BY sent_at DESC))[1]                AS last_error,
       to_char(max(sent_at) AT TIME ZONE 'Asia/Seoul', 'HH24:MI') AS last_at
FROM tp23.sf_log_history
WHERE to_char(sent_at AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD') = $1
GROUP BY set_code
`;
async function fetchLogSummary(dateKey) {
    if (!process.env.PG_PASSWORD) return null;
    const client = new Client({
        host: '175.193.55.102', port: 5432, database: 'postgres', user: 'postgres',
        password: process.env.PG_PASSWORD, ssl: false, connectionTimeoutMillis: 5000,
    });
    try {
        await client.connect();
        await ensureHistoryTable(client);
        const { rows } = await client.query(LOG_SUMMARY_SQL, [dateKey]);
        return Object.fromEntries(rows.map((r) => [r.set_code, r]));
    } catch {
        return null;
    } finally {
        try { await client.end(); } catch { /* 무시 */ }
    }
}

const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function buildReport(dateKey, logSummary, historyUrl) {
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

    const logLine = (set) => {
        const l = logSummary && logSummary[set];
        if (!l) return '전송 없음';
        const last = describeResult(l.last_code, l.last_error);
        return `전송 ${l.sent}건, 정상 저장(AP1002) ${l.ok}건${l.tests ? `, 테스트 ${l.tests}건` : ''}${l.errors ? `, 오류 ${l.errors}건` : ''}, 마지막 ${last.code} ${last.meaning} (${l.last_at})${last.level === 'error' ? ` → ${last.action}` : ''}`;
    };
    const text = [
        `${subject}`,
        '',
        ...rows.flatMap((r) => [
            `■ ${r.name} (${r.product}) — 도달 ${formatKstMin(r.reach)}, 종합 개선율 ${fmtPct(r.total)}`,
            ...r.indicators.map((k) => `  - ${k.label}: 구축 전 ${fmtNum(k.before)} / 목표 ${fmtNum(k.target)} / 구축 후 ${fmtNum(k.after)} / 개선율 ${fmtPct(k.rate)}`),
        ]),
        ...(logSummary ? [
            '',
            '■ 스마트공장 로그 전송(오늘, 발송 시점 기준)',
            ...rows.map((r) => `  - ${r.name}: ${logLine(r.set)}`),
            `  이력: ${historyUrl}`,
        ] : []),
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
  ${logSummary ? `<h4 style="margin:14px 0 6px">스마트공장 로그 전송(오늘, 발송 시점 기준)</h4>
  <table style="border-collapse:collapse">
    <tr><th ${th}>업체</th><th ${th}>전송</th><th ${th}>정상 저장(AP1002)</th><th ${th}>테스트</th><th ${th}>오류</th><th ${th}>마지막 결과</th></tr>
    ${rows.map((r) => {
        const l = logSummary[r.set];
        const last = l ? describeResult(l.last_code, l.last_error) : null;
        const lastHtml = last ? `${escapeHtml(last.code)} ${escapeHtml(last.meaning)} (${l.last_at})${last.level === 'error' ? `<br><b style="color:#c00">조치: ${escapeHtml(last.action)}</b>` : ''}` : '전송 없음';
        return `<tr><td ${tdl}>${escapeHtml(r.name)}</td><td ${td}>${l ? l.sent : 0}</td><td ${td}>${l ? l.ok : 0}</td><td ${td}>${l ? l.tests : 0}</td><td ${l && l.errors ? 'style="border:1px solid #ccc;padding:4px 8px;text-align:right;color:#c00;font-weight:bold"' : td}>${l ? l.errors : 0}</td><td ${tdl}>${lastHtml}</td></tr>`;
    }).join('')}
  </table>
  <p style="margin:6px 0 0"><a href="${escapeHtml(historyUrl)}">전송 이력 보기</a></p>` : ''}
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
    const dry = query.dry === '1';
    const test = !dry && query.test === '1'; // 즉시 발송 테스트(제목 앞 [테스트], 하루 1통)
    // 실제 발송은 오늘(KST)만 — 같은 날 중복 방지 키와 함께 하루 최대 1통으로 제한
    if (!dry && query.date) {
        res.status(400).json({ error: 'date_not_allowed', message: '날짜 지정은 dry=1 에서만 가능합니다.' });
        return;
    }
    const dateKey = /^\d{4}-\d{2}-\d{2}$/.test(String(query.date || '')) ? String(query.date) : kstParts(new Date()).dateKey;

    if (!isKpiWorkday(dateKey)) {
        res.status(200).json({ date: dateKey, skipped: 'not_a_workday' });
        return;
    }

    const historyUrl = `https://${req.headers.host || 'viewer-five-beta.vercel.app'}/sflog.html`;
    const report = buildReport(dateKey, await fetchLogSummary(dateKey), historyUrl);
    const reached = Date.now() >= report.sendAt.getTime();
    const subject = test ? `[테스트] ${report.subject}` : report.subject;
    const summary = {
        date: dateKey,
        send_at_kst: `${dateKey} ${formatKstMin(kstParts(report.sendAt).min)}`,
        reached,
        reach_kst: Object.fromEntries(report.rows.map((r) => [r.name, formatKstMin(r.reach)])),
        subject,
        ...(test ? { test: true } : {}),
    };

    const apiKey = process.env.RESEND_API_KEY;
    const to = String(process.env.KPI_REPORT_TO || '').split(',').map((s) => s.trim()).filter(Boolean);

    if (dry) {
        // 값은 노출하지 않고 설정 여부만 표시
        const envReady = { RESEND_API_KEY: Boolean(apiKey), KPI_REPORT_TO_count: to.length, CRON_SECRET: Boolean(secret) };
        res.status(200).json({ ...summary, dry: true, env_ready: envReady, text: report.text });
        return;
    }

    if (!test && !reached) {
        res.status(200).json({ ...summary, waiting: true });
        return;
    }

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
                // 본문이 날짜별로 항상 같아 같은 날 반복 호출은 같은 메일로 처리됨(재발송 없음)
                'Idempotency-Key': `tp23-kpi-${test ? 'test' : 'send'}-${dateKey}`,
            },
            body: JSON.stringify({
                from: process.env.KPI_REPORT_FROM || DEFAULT_FROM,
                to,
                subject,
                html: report.html,
                text: report.text,
            }),
        });
        const data = await r.json().catch(() => ({}));
        if (r.status === 409) {
            res.status(200).json({ ...summary, already_sent: true, detail: data.name });
            return;
        }
        if (!r.ok) {
            res.status(502).json({ ...summary, error: 'send_failed', status: r.status, detail: data });
            return;
        }
        res.status(200).json({ ...summary, sent: true, id: data.id });
    } catch (err) {
        res.status(502).json({ ...summary, error: 'send_failed', message: String(err) });
    }
}
