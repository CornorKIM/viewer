// Settings the gates hand to sf-daily through process.env (see tests/lib/README.md).
// DB coordinates (PG_HOST, PG_PASSWORD, SF_DB_URL) come from the harness compose file.
// All values here are fake and only meaningful against the in-process stubs.
import { ROSTER } from './roster.js';

export const TEST_KEYS = {
    SF_LOG_KEY_A: 'GATEKEY-A-must-not-leak',
    SF_LOG_KEY_B: 'GATEKEY-B-must-not-leak',
    SF_LOG_KEY_C: 'GATEKEY-C-must-not-leak',
    SF_LOG_KEY_D: 'GATEKEY-D-must-not-leak',
    SF_LOG_KEY_TP1_CDR: 'GATEKEY-CDR-must-not-leak',
};
export const keyOf = (code) => TEST_KEYS[ROSTER.find((c) => c.code === code).keyEnv];

export const SMTP = {
    host: 'smtp.test',
    user: 'sfdaily-gate@smtp.test',
    pass: 'GATESMTPPASS-must-not-leak',
};
export const REPORT_TO = ['ops1@example.test', 'ops2@example.test'];
export const TEST_IP = '10.20.30.40';

/** Every secret a gate checks for leaks. */
export function secrets() {
    return [...Object.values(TEST_KEYS), SMTP.pass, process.env.PG_PASSWORD].filter(Boolean);
}

/** Base settings for in-process gate files. Call before the first import of an sf-daily module. */
export function applyBaseEnv(extra = {}) {
    Object.assign(process.env, TEST_KEYS, {
        SMTP_HOST: SMTP.host,
        SMTP_USER: SMTP.user,
        SMTP_PASS: SMTP.pass,
        SF_REPORT_TO: REPORT_TO.join(','),
        SF_LOG_DEFAULT_IP: TEST_IP,
    });
    for (const k of ['SMTP_PORT', 'SF_HOLIDAY_CALENDAR_URL', 'SF_REPORT_LINK', 'SF_DAILY_FAKE_NOW', 'SF_DAILY_ENABLED', 'SF_DAILY_TICK_SECONDS', 'SF_REPORT_AT']) delete process.env[k];
    for (const [k, v] of Object.entries(extra)) {
        if (v === null) delete process.env[k]; else process.env[k] = v;
    }
}

/** A full, valid service configuration (for spawning sf-daily/main.js). */
export function serviceEnv(overrides = {}) {
    return {
        ...TEST_KEYS,
        SF_DAILY_ENABLED: 'true',
        SMTP_HOST: SMTP.host,
        SMTP_USER: SMTP.user,
        SMTP_PASS: SMTP.pass,
        SF_REPORT_TO: REPORT_TO.join(','),
        SF_LOG_DEFAULT_IP: TEST_IP,
        PG_HOST: process.env.PG_HOST,
        PG_PASSWORD: process.env.PG_PASSWORD,
        SF_DB_URL: process.env.SF_DB_URL,
        ...overrides,
    };
}
