// step-sender (docs/spec/sf-daily/spec/step-sender.md · api/step-sender.md):
// one step of one company on one day — check, claim, send once, record every request in the history.
import { SF_LOG_URL, DB_HOST } from '../api/_sf-send.js';
import { now } from './clock.js';
import { kstDate, kstLogDt, isDateString } from './kst.js';
import { companyOf, stepOf, previousStep, keyOf } from './companies.js';
import { normalSaveCount, requestedWithin, appendRow } from './history.js';
import { randomUUID } from 'node:crypto';
import { dedicatedClient, dedicatedQuery, LOCK, dbError } from './db.js';

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

// ── send journal (step-sender §5) ───────────────────────────────────────────

/** Check 4 in the journal: an entry with no outcome (result never written) or with AP1002 counts as stored. */
async function journalStored(company, date, step) {
    const r = await dedicatedQuery(
        `SELECT 1 FROM sf_daily_send_journal
          WHERE company = $1 AND send_date = $2 AND step = $3 AND (outcome IS NULL OR result_code = 'AP1002') LIMIT 1`,
        [company.code, date, step.step],
    );
    return r.rowCount > 0;
}

/** Check 5 in the journal: a request of this company less than `minutes` ago. */
async function journalRequestedWithin(company, minutes) {
    const r = await dedicatedQuery(
        'SELECT 1 FROM sf_daily_send_journal WHERE company = $1 AND requested_at > now() - make_interval(mins => $2) LIMIT 1',
        [company.code, minutes],
    );
    return r.rowCount > 0;
}

const stored = async (company, date, step) => (await normalSaveCount(company, date, step.useSe)) >= 1 || journalStored(company, date, step);
const recent = async (company) => (await requestedWithin(company, WAIT_MIN)) || journalRequestedWithin(company, WAIT_MIN);

// Check 5 hit: a concurrent sender of this very step may have journalled between our check 4 and check 5.
// Its journal entry is visible now, so asking check 4 again turns that race into already_stored.
const waitOrStored = async (company, date, step) => result((await stored(company, date, step)) ? 'already_stored' : 'wait_10min');

const rowFields = (e) => ({ logDt: e.log_dt, useSe: e.use_se, sysUser: e.sys_user, conectIp: e.conect_ip, dataUsgqty: '0' });
const rowResponse = (e) => (e.http_status === null && !e.result_code ? null : {
    http: e.http_status === null ? null : Number(e.http_status), code: e.result_code, message: e.result_msg, detail: e.result_detail, at: e.recptn_dt,
});

/** Writes the history rows of journal entries whose row write failed, with the original request time. */
async function rewriteUnrecorded() {
    let c;
    try { c = await dedicatedClient(); } catch { return; }
    try {
        await c.query('BEGIN');
        const { rows } = await c.query(
            "SELECT * FROM sf_daily_send_journal WHERE history_state = 'unrecorded' ORDER BY requested_at FOR UPDATE SKIP LOCKED",
        );
        for (const e of rows) {
            const company = companyOf(e.company);
            if (!company) continue;
            let row;
            try {
                row = await appendRow(company, rowFields(e), rowResponse(e), e.error, e.requested_at);
            } catch (err) {
                console.error(`[sf-daily] 이력 다시 쓰기 실패 ${e.company} ${e.send_date} ${e.step}: ${dbError(err).message}`);
                break; // the history DB is still refusing; try again on the next send request
            }
            await c.query("UPDATE sf_daily_send_journal SET history_state = 'recorded', history_table = $2, history_id = $3 WHERE entry_id = $1",
                [e.entry_id, row.table, row.id]);
        }
        await c.query('COMMIT');
    } catch (err) {
        await c.query('ROLLBACK').catch(() => {});
        console.error(`[sf-daily] 이력 다시 쓰기 오류: ${dbError(err).message}`);
    } finally { c.release(); }
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

    // Late history rows of earlier requests first, so the counts below see them.
    await rewriteUnrecorded();

    // 3 · 4 · 5: the history (and for 4 · 5 the send journal)
    const prev = previousStep(step.step);
    if (prev && (await normalSaveCount(company, date, prev.useSe)) === 0) return result('previous_missing');
    if (await stored(company, date, step)) return result('already_stored');
    if (await recent(company)) return waitOrStored(company, date, step);

    const key = keyOf(company.code);
    if (!key) throw new Error(`${company.keyEnv} 가 비어 있다`);

    // Claim company · date · step with a session lock for the whole send; a concurrent claimant gets in_progress.
    // The lock dies with the connection, so a killed sender never leaves the step claimed.
    const c = await dedicatedClient();
    const lockArgs = [LOCK.step, `${company.code}|${date}|${step.step}`];
    let locked = false;
    try {
        const got = await c.query('SELECT pg_try_advisory_lock($1, hashtext($2)) AS ok', lockArgs);
        locked = got.rows[0].ok;
        if (!locked) return result('in_progress');
        // Re-check under the claim: another sender may have finished between the checks and the claim.
        if (await stored(company, date, step)) return result('already_stored');
        if (await recent(company)) return waitOrStored(company, date, step);

        const at = now();
        if (kstDate(at) !== date) return result('past_day');
        const fields = {
            logDt: kstLogDt(at),
            useSe: step.useSe,
            sysUser: company.sysUser,
            conectIp: conectIp().slice(0, 30),
            dataUsgqty: '0',
        };
        // The journal entry is committed before the request leaves.
        const entryId = randomUUID();
        await c.query(
            `INSERT INTO sf_daily_send_journal (entry_id, company, send_date, step, use_se, log_dt, sys_user, conect_ip)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [entryId, company.code, date, step.step, fields.useSe, fields.logDt, fields.sysUser, fields.conectIp],
        );

        const { response, error } = await postLog({ crtfcKey: key, ...fields });
        const outcome = error ? 'send_failed' : response.code === 'AP1002' ? 'stored' : 'error_response';
        const r = response || {};
        try {
            await c.query(
                `UPDATE sf_daily_send_journal SET outcome = $2, result_code = $3, http_status = $4, result_msg = $5,
                        result_detail = $6, recptn_dt = $7, error = $8 WHERE entry_id = $1`,
                [entryId, outcome, r.code ?? null, r.http === undefined || r.http === null ? null : String(r.http),
                    r.message ?? null, r.detail ?? null, r.at ?? null, error],
            );
        } catch (err) {
            // Left without an outcome the entry counts as stored — one send too few rather than one too many.
            console.error(`[sf-daily] 전송 일지 결과 기록 실패 ${company.code} ${date} ${step.step}: ${dbError(err).message}`);
        }

        let row = null;
        try {
            row = await appendRow(company, fields, response, error);
        } catch (err) {
            console.error(`[sf-daily] 이력 기록 실패 ${company.code} ${date} ${step.step} (다음 보내기 때 다시 쓴다): ${dbError(err).message}`);
        }
        await c.query(
            'UPDATE sf_daily_send_journal SET history_state = $2, history_table = $3, history_id = $4 WHERE entry_id = $1',
            [entryId, row ? 'recorded' : 'unrecorded', row?.table ?? null, row?.id ?? null],
        ).catch((err) => console.error(`[sf-daily] 전송 일지 이력 상태 기록 실패 ${company.code}: ${dbError(err).message}`));

        if (outcome === 'send_failed') return result('send_failed', null, error);
        return result(outcome, response.code, response.message);
    } catch (err) {
        throw dbError(err);
    } finally {
        let broken = false;
        if (locked) await c.query('SELECT pg_advisory_unlock($1, hashtext($2))', lockArgs).catch(() => { broken = true; });
        c.release(broken); // a client that may still hold the lock is closed, which frees the lock
    }
}
