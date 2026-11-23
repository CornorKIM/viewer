// step-sender (docs/spec/sf-daily/spec/step-sender.md · api/step-sender.md):
// one step of one company on one day — check, claim, send once, record every request in the history.
import { SF_LOG_URL, DB_HOST } from '../api/_sf-send.js';
import { now } from './clock.js';
import { kstDate, kstLogDt, isDateString } from './kst.js';
import { companyOf, stepOf, previousStep, keyOf } from './companies.js';
import { normalSaveCount, requestedWithin, appendRow } from './history.js';
import { inDedicatedTx, LOCK, dbError } from './db.js';

const SEND_TIMEOUT_MS = 20_000;
const WAIT_MIN = 10;

const result = (outcome, resultCode = null, message = null) => ({ outcome, resultCode, message });

function validate(request) {
    if (!request || typeof request !== 'object') throw new TypeError('request 가 없다');
    const { company, date, step, windowEnd } = request;
    if (typeof company !== 'string' || !companyOf(company)) throw new TypeError('company 가 업체 명부에 없다');
    if (!isDateString(date)) throw new TypeError('date 는 YYYY-MM-DD 형식의 있는 날짜여야 한다');
    if (typeof step !== 'string' || !stepOf(step)) throw new TypeError('step 은 login · query · logout 중 하나여야 한다');
    if (!(windowEnd instanceof Date) || Number.isNaN(windowEnd.getTime())) throw new TypeError('windowEnd 는 유효한 Date 여야 한다');
}

const conectIp = () => String(process.env.SF_LOG_DEFAULT_IP ?? '').trim() || DB_HOST;

/** Posts one log. → { response: { http, code, message, detail, at } | null, error: string | null } */
async function postLog(fields) {
    let r;
    try {
        r = await fetch(SF_LOG_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
            body: new URLSearchParams(fields).toString(),
            signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
    } catch (err) {
        return { response: null, error: `send_failed: ${err?.cause?.code || err?.name || 'error'} ${String(err?.message ?? '')}`.trim() };
    }
    let text;
    try { text = await r.text(); } catch (err) {
        return { response: { http: r.status }, error: `response_unreadable: ${String(err?.message ?? err)}` };
    }
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    const res = data && typeof data === 'object' ? (data.result && typeof data.result === 'object' ? data.result : data) : null;
    const code = res && typeof res.recptnRsltCd === 'string' && res.recptnRsltCd ? res.recptnRsltCd : null;
    if (!code) return { response: { http: r.status }, error: `response_unreadable: HTTP ${r.status}` };
    const str = (v) => (v === undefined || v === null || v === '' ? null : String(v));
    return { response: { http: r.status, code, message: str(res.recptnRslt), detail: str(res.recptnRsltDtl), at: str(res.recptnDt) }, error: null };
}

/** sendStep({ company, date, step, windowEnd }) → { outcome, resultCode, message } */
export async function sendStep(request) {
    validate(request);
    const company = companyOf(request.company);
    const step = stepOf(request.step);
    const { date, windowEnd } = request;

    // 1 · 2: the clock alone
    if (kstDate(now()) !== date) return result('past_day');
    if (now().getTime() >= windowEnd.getTime()) return result('window_passed');

    // 3 · 4 · 5: the history
    const prev = previousStep(step.step);
    if (prev && (await normalSaveCount(company, date, prev.useSe)) === 0) return result('previous_missing');
    if ((await normalSaveCount(company, date, step.useSe)) >= 1) return result('already_stored');
    if (await requestedWithin(company, WAIT_MIN)) return result('wait_10min');

    const key = keyOf(company.code);
    if (!key) throw new Error(`${company.keyEnv} 가 비어 있다`);

    // Claim company · date · step for the duration of the send; a concurrent claimant gets in_progress.
    return inDedicatedTx(async (c) => {
        const got = await c.query('SELECT pg_try_advisory_xact_lock($1, hashtext($2)) AS ok', [LOCK.step, `${company.code}|${date}|${step.step}`]);
        if (!got.rows[0].ok) return result('in_progress');
        // Re-check under the claim: another sender may have finished between the checks and the claim.
        if ((await normalSaveCount(company, date, step.useSe)) >= 1) return result('already_stored');
        if (await requestedWithin(company, WAIT_MIN)) return result('wait_10min');

        const at = now();
        if (kstDate(at) !== date) return result('past_day');
        const fields = {
            logDt: kstLogDt(at),
            useSe: step.useSe,
            sysUser: company.sysUser,
            conectIp: conectIp().slice(0, 30),
            dataUsgqty: '0',
        };
        const { response, error } = await postLog({ crtfcKey: key, ...fields });
        let row = null;
        try {
            row = await appendRow(company, fields, response, error);
        } catch (err) {
            console.error(`[sf-daily] 이력 기록 실패 ${company.code} ${date} ${step.step}: ${dbError(err).message}`);
        }
        if (row && company.history === 'tp23') {
            // The tp23 table has no source column: the auto-send mark is this row id in the dedicated DB.
            await c.query(
                'INSERT INTO sf_daily_auto_send (history_table, history_id, company, send_date, step) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING',
                [row.table, row.id, company.code, date, step.step],
            ).catch((err) => console.error(`[sf-daily] 자동 전송 표시 실패 ${company.code} 이력 ${row.id}: ${dbError(err).message}`));
        }
        if (error) return result('send_failed', null, error);
        if (response.code === 'AP1002') return result('stored', response.code, response.message);
        return result('error_response', response.code, response.message);
    });
}
