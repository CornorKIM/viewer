// The roster as fixed by docs/spec/sf-daily/spec/companies.md (tables 1–3). Test fixture only.
export const ROSTER = [
    { code: 'A', type: '유형2-3', name: '목공소 봄', keyEnv: 'SF_LOG_KEY_A', sysUser: '목공소 봄', equipmentNo: '24424', table: 'tp23.sf_log_history', col: 'set_code' },
    { code: 'B', type: '유형2-3', name: '이레공방', keyEnv: 'SF_LOG_KEY_B', sysUser: '이레공방', equipmentNo: '42504', table: 'tp23.sf_log_history', col: 'set_code' },
    { code: 'C', type: '유형2-3', name: '브랜드스미스', keyEnv: 'SF_LOG_KEY_C', sysUser: '브랜드스미스', equipmentNo: '02895', table: 'tp23.sf_log_history', col: 'set_code' },
    { code: 'D', type: '유형2-3', name: '비스트럭처', keyEnv: 'SF_LOG_KEY_D', sysUser: '비스트럭처', equipmentNo: '75980', table: 'tp23.sf_log_history', col: 'set_code' },
    { code: 'CDR', type: '유형1', name: '(주)CDR시스템', keyEnv: 'SF_LOG_KEY_TP1_CDR', sysUser: '(주)CDR시스템', equipmentNo: null, table: 'tp1.sf_log_history', col: 'company_code' },
];
export const CODES = ROSTER.map((c) => c.code);
export const byCode = (code) => ROSTER.find((c) => c.code === code);

export const STEPS = [
    { step: 'login', useSe: 'DO6001' },
    { step: 'query', useSe: 'DO6003' },
    { step: 'logout', useSe: 'DO6002' },
];
export const useSeOf = (step) => STEPS.find((s) => s.step === step).useSe;

// KST windows [start, end) as 'HH:MM'. Query is relative to the planned login (minutes).
export const WINDOWS = {
    '유형2-3': { login: ['10:00', '12:00'], logout: ['17:00', '20:00'] },
    '유형1': { login: ['10:00', '11:00'], logout: ['17:00', '22:00'] },
};
export const QUERY_OFFSET_MIN = [30, 180];
