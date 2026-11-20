// 스마트공장 사업관리시스템 로그 수집 API 결과 코드(연동규격서 v1.7 「5. 공통결과 코드」).
// level: ok = 정상 저장 / test = 테스트 확인(미저장) / info = 수신만(정상 동작 범위) / error = 확인·조치 필요
export const SF_RESULT_CODES = {
    AP1001: { meaning: '데이터 수신 완료', level: 'info', action: '수신만 확인됨. 저장(AP1002) 여부는 사업관리시스템에서 확인' },
    AP1002: { meaning: '데이터 이관 완료(정상 저장)', level: 'ok', action: '' },
    AP1003: { meaning: '데이터 이관 완료 오류 — 인증키 불일치', level: 'error', action: '해당 업체 인증키(SF_LOG_KEY_*)가 맞는지 확인' },
    AP1004: { meaning: '데이터 수신 오류 — 값이 범위를 벗어남', level: 'error', action: '보낸 값(일시·사용량 등) 확인' },
    AP1010: { meaning: '기타 오류', level: 'error', action: '상세 설명 확인, 반복되면 사업관리시스템 문의' },
    AP1011: { meaning: 'API 인증키 없음', level: 'error', action: '해당 업체 인증키 환경변수 등록 확인' },
    AP1012: { meaning: '로그 일시 없음', level: 'error', action: '전송 코드(logDt) 확인' },
    AP1013: { meaning: '로그 일시 길이 오류', level: 'error', action: '형식 YYYY-MM-DD HH:MI:SS.SSS(23자) 확인' },
    AP1014: { meaning: '로그 일시 형식 오류', level: 'error', action: '형식 YYYY-MM-DD HH:MI:SS.SSS 확인' },
    AP1015: { meaning: '사용 구분 없음', level: 'error', action: '사용 구분 코드(useSe) 확인' },
    AP1016: { meaning: '사용 구분 200자 초과', level: 'error', action: '사용 구분 코드 확인' },
    AP1017: { meaning: '시스템 사용자 없음', level: 'error', action: '사용자(장비 번호) 확인' },
    AP1018: { meaning: '시스템 사용자 60자 초과', level: 'error', action: '사용자 값 길이 확인' },
    AP1019: { meaning: '접속 IP 없음', level: 'error', action: '접속 IP 설정 확인' },
    AP1020: { meaning: '접속 IP 30자 초과', level: 'error', action: '접속 IP 값 확인' },
    AP1021: { meaning: '데이터 사용량이 숫자가 아님', level: 'error', action: '데이터 사용량 값 확인' },
    AP1022: { meaning: '데이터 사용량 공백', level: 'error', action: '데이터 사용량 값 확인(없으면 0)' },
    AP1023: { meaning: 'JSON 데이터 형식 오류', level: 'error', action: '전송 형식 확인' },
    AP1024: { meaning: 'XML 데이터 형식 오류', level: 'error', action: '전송 형식 확인' },
    AP1025: { meaning: '데이터 전송 오류 — 데이터 없음 또는 형식 아님', level: 'error', action: '전송 형식 확인' },
    AP1026: { meaning: '데이터 사용량 10자리 이상', level: 'error', action: '데이터 사용량 10억 미만인지 확인' },
    AP1027: { meaning: '로그 일시 오류 — 오늘 날짜가 아님', level: 'error', action: '서버 시각·날짜 확인(당일 로그만 전송 가능)' },
    AP1028: { meaning: 'TEST DATA 체크 완료(테스트, 미저장)', level: 'test', action: '' },
    AP1029: { meaning: '10분 이내 재전송 — 수신만, 미저장', level: 'info', action: '정상 범위(저장은 10분 간격)' },
    AP1030: { meaning: 'LOG 수집 미대상 — 과제 정보 없음 또는 수집기간 종료', level: 'error', action: '경기TP·사업관리시스템에 과제 등록·수집기간 확인' },
    AP1031: { meaning: '하루 요청 5,000건 초과', level: 'error', action: '호출 주기 확인(차단될 수 있음)' },
    AP1032: { meaning: '하루 성공 144건 초과', level: 'error', action: '호출 주기 확인' },
    AP1033: { meaning: '하루 실패 200건 초과', level: 'error', action: '오류 원인부터 해결(차단될 수 있음)' },
};

const LOCAL_ERRORS = {
    missing_key: { meaning: '인증키 미등록(전송 안 함)', action: 'Vercel 환경변수 SF_LOG_KEY_* 등록 확인' },
    send_failed: { meaning: '사업관리시스템 연결 실패', action: '네트워크·사업관리시스템 상태 확인 후 재시도' },
};

// { code, meaning, level, action } — 결과 코드 또는 우리 쪽 오류(error 문자열)로 설명
export function describeResult(code, error) {
    if (error) {
        const key = String(error).split(':')[0];
        const e = LOCAL_ERRORS[key] || { meaning: String(error).slice(0, 120), action: '오류 내용 확인' };
        return { code: code || key, meaning: e.meaning, level: 'error', action: e.action };
    }
    if (!code) return { code: '-', meaning: '응답 코드 없음', level: 'error', action: '사업관리시스템 응답 확인' };
    const c = SF_RESULT_CODES[code];
    return c ? { code, ...c } : { code, meaning: '규격서에 없는 코드', level: 'error', action: '사업관리시스템 문의' };
}

// SQL 조건: 오류로 셀 행(우리 쪽 오류 또는 ok/test/info가 아닌 코드)
export const SF_NOT_ERROR_CODES = Object.entries(SF_RESULT_CODES).filter(([, v]) => v.level !== 'error').map(([k]) => k);
export const SF_ERROR_FILTER_SQL = `(error IS NOT NULL OR result_code IS NULL OR result_code NOT IN (${SF_NOT_ERROR_CODES.map((c) => `'${c}'`).join(',')}))`;
