// The roster (docs/spec/sf-daily/spec/companies.md): five companies, three steps, windows per type.
export const COMPANIES = Object.freeze([
    { code: 'A', type: '유형2-3', name: '목공소 봄', keyEnv: 'SF_LOG_KEY_A', sysUser: '목공소 봄', equipmentNo: '24424', history: 'tp23' },
    { code: 'B', type: '유형2-3', name: '이레공방', keyEnv: 'SF_LOG_KEY_B', sysUser: '이레공방', equipmentNo: '42504', history: 'tp23' },
    { code: 'C', type: '유형2-3', name: '브랜드스미스', keyEnv: 'SF_LOG_KEY_C', sysUser: '브랜드스미스', equipmentNo: '02895', history: 'tp23' },
    { code: 'D', type: '유형2-3', name: '비스트럭처', keyEnv: 'SF_LOG_KEY_D', sysUser: '비스트럭처', equipmentNo: '75980', history: 'tp23' },
    { code: 'CDR', type: '유형1', name: '(주)CDR시스템', keyEnv: 'SF_LOG_KEY_TP1_CDR', sysUser: '(주)CDR시스템', equipmentNo: null, history: 'tp1' },
].map(Object.freeze));

export const STEPS = Object.freeze([
    { step: 'login', name: '로그인', useSe: 'DO6001' },
    { step: 'query', name: '조회', useSe: 'DO6003' },
    { step: 'logout', name: '로그아웃', useSe: 'DO6002' },
].map(Object.freeze));

/** KST windows [start, end) as 'HH:MM'. The query window is relative to the planned login (minutes). */
export const WINDOWS = Object.freeze({
    '유형2-3': Object.freeze({ login: ['10:00', '12:00'], logout: ['17:00', '20:00'] }),
    '유형1': Object.freeze({ login: ['10:00', '11:00'], logout: ['17:00', '22:00'] }),
});
export const QUERY_OFFSET_MIN = Object.freeze([30, 180]);

export const companyOf = (code) => COMPANIES.find((c) => c.code === code) || null;
export const stepOf = (step) => STEPS.find((s) => s.step === step) || null;
export function previousStep(step) {
    const i = STEPS.findIndex((s) => s.step === step);
    return i > 0 ? STEPS[i - 1] : null;
}

/** The company's key from the environment ('' when unset). It leaves sf-daily only inside a log API request. */
export const keyOf = (code, env = process.env) => String(env[companyOf(code).keyEnv] ?? '').trim();

/** Names of the key settings that are empty, in roster order. */
export function missingKeys(env = process.env) {
    return COMPANIES.filter((c) => !String(env[c.keyEnv] ?? '').trim()).map((c) => c.keyEnv);
}
