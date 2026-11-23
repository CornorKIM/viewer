// Manual smart-factory log send test: sends one or more steps of the usage flow
// (login → query → register → logout) for one company, records each result in the
// same history tables the viewer uses, and prints the server's result code.
//
// Run inside the container (keys come from .env):
//   docker compose exec viewer node docker/sf-flow.mjs <A|B|C|D|CDR> [options]
// Options:
//   --steps login,query,register,logout   steps to send, in order (default: login)
//   --qty N        dataUsgqty for the register step (default 0)
//   --gap MIN      minutes to wait between steps (default 10; the log server stores
//                  at most one log per 10 minutes, faster sends come back AP1029 and are not stored)
//   --test         send every step as DO6999 (test code, not counted in statistics)
//   --dry          print what would be sent; no send, no history row
import pg from 'pg';
import { PG_CONFIG, SET_EQUIPMENT_NO, sfKey, kstLogDt, sendSfLog, DB_HOST } from '../api/_sf-send.js';
import { insertHistory, SET_NAMES } from '../api/_sf-history.js';
import { insertTp1History, TP1_COMPANIES, tp1Key } from '../api/_tp1.js';
import { describeResult } from '../api/_sf-codes.js';

const STEP_CODES = { login: 'DO6001', logout: 'DO6002', query: 'DO6003', register: 'DO6004' };

function parseArgs(argv) {
    const opts = { steps: ['login'], qty: 0, gap: 10, test: false, dry: false };
    const rest = [];
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--steps') opts.steps = String(argv[++i] || '').split(',').map((s) => s.trim()).filter(Boolean);
        else if (a === '--qty') opts.qty = Number(argv[++i]);
        else if (a === '--gap') opts.gap = Number(argv[++i]);
        else if (a === '--test') opts.test = true;
        else if (a === '--dry') opts.dry = true;
        else rest.push(a);
    }
    opts.target = String(rest[0] || '').toUpperCase();
    return opts;
}

function fail(msg) {
    console.error(`error: ${msg}`);
    console.error('usage: node docker/sf-flow.mjs <A|B|C|D|CDR> [--steps login,query,register,logout] [--qty N] [--gap MIN] [--test] [--dry]');
    process.exit(2);
}

const opts = parseArgs(process.argv.slice(2));
const isTp1 = opts.target === 'CDR';
if (!isTp1 && !SET_EQUIPMENT_NO[opts.target]) fail(`unknown company "${opts.target}"`);
if (isTp1 && !TP1_COMPANIES.CDR) fail('TP1 company CDR not defined');
const bad = opts.steps.filter((s) => !STEP_CODES[s]);
if (opts.steps.length === 0 || bad.length) fail(`unknown step(s): ${bad.join(',') || '(none)'}`);
if (!Number.isInteger(opts.qty) || opts.qty < 0 || opts.qty >= 1e9) fail('--qty must be an integer 0..999999999');
if (!(opts.gap >= 0)) fail('--gap must be >= 0');

const key = isTp1 ? tp1Key('CDR') : sfKey(opts.target);
const name = isTp1 ? TP1_COMPANIES.CDR.name : SET_NAMES[opts.target];
const conectIp = (isTp1 ? process.env.TP1_LOG_IP_CDR : process.env[`SF_LOG_IP_${opts.target}`])
    || process.env.SF_LOG_DEFAULT_IP || DB_HOST;
if (!key && !opts.dry) fail(`no key for ${opts.target} (${isTp1 ? 'SF_LOG_KEY_TP1_CDR' : `SF_LOG_KEY_${opts.target}`} in .env)`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`${name} (${opts.target}) — steps: ${opts.steps.join(' → ')}${opts.test ? ' [DO6999 test]' : ''}${opts.dry ? ' [dry]' : ''}, gap ${opts.gap} min`);

const client = new pg.Client(PG_CONFIG);
if (!opts.dry) await client.connect();
let failed = 0;
try {
    for (let i = 0; i < opts.steps.length; i++) {
        if (i > 0 && opts.gap > 0) {
            console.log(`  waiting ${opts.gap} min…`);
            if (!opts.dry) await sleep(opts.gap * 60 * 1000);
        }
        const step = opts.steps[i];
        const fields = {
            crtfcKey: key || '',
            logDt: kstLogDt(),
            useSe: opts.test ? 'DO6999' : STEP_CODES[step],
            // Same sysUser convention as the viewer: company name, equipment no. for tp23 register.
            sysUser: !isTp1 && step === 'register' ? SET_EQUIPMENT_NO[opts.target] : name,
            conectIp: String(conectIp).slice(0, 30),
            dataUsgqty: String(step === 'register' ? opts.qty : 0),
        };
        const shown = { ...fields, crtfcKey: key ? '(set)' : '(missing)' };
        if (opts.dry) {
            console.log(`  [${step}]`, JSON.stringify(shown));
            continue;
        }
        let response;
        let error;
        try { response = await sendSfLog(fields); } catch (err) { error = `send_failed: ${String(err)}`; }
        const result = describeResult(response && response.code, error);
        try {
            if (isTp1) await insertTp1History(client, { code: 'CDR', source: 'manual', test: opts.test, fields, response, error });
            else await insertHistory(client, { set: opts.target, equipmentNo: SET_EQUIPMENT_NO[opts.target], test: opts.test, fields, response, error });
        } catch (err) {
            console.error(`  history insert failed: ${String(err)}`);
        }
        const ok = response && (response.code === 'AP1002' || (opts.test && response.code === 'AP1028'));
        if (!ok) failed++;
        console.log(`  [${step}] ${fields.useSe} ${fields.logDt} → ${response ? `${response.code} ${response.message || ''}`.trim() : error}`
            + `${result && result.meaning ? ` (${result.meaning})` : ''}${response && response.detail ? ` — ${response.detail}` : ''}`);
    }
} finally {
    if (!opts.dry) await client.end();
}
process.exit(failed ? 1 : 0);
