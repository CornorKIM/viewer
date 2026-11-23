# 사업관리시스템 로그수집 API(제품 밖 · 읽기 전용) — 게이트

> 계약: `docs/spec/interfaces/sf-log-api.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 우리 쪽(step-sender)이 이 API 에 무엇을 보내고 응답을 어떻게 읽는지만, 같은 주소의 가짜 HTTPS 서버에서 잰다.
> AP1002 · AP1029 의 분류는 SS-13, 닿지 못함은 SS-14 가 잰다.

## 명제

### IA-01. 계약 주소로 POST, form-urlencoded UTF-8 본문에 여섯 필드

- **등급**: 핵심
- **겨누는 조항**: 표면 — 요청 · 필드 표
- **판정**: 요청이 `log.smart-factory.kr` 의 `/apisvc/sendLogData.json` 로 가는 POST 이고, Content-Type 이 `application/x-www-form-urlencoded` 에 `charset=UTF-8`, 본문에 `crtfcKey` · `logDt` · `useSe` · `sysUser` · `conectIp` · `dataUsgqty` 가 비지 않고 있으며, 한글 `sysUser` 가 그대로 읽히고 `sysUser` 60자 · `conectIp` 30자 이하, `dataUsgqty` 는 정수다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-api/request.test.js::IA-01`

### IA-02. logDt 는 23자 KST 시각이다

- **등급**: 핵심
- **겨누는 조항**: 필드 표 `logDt`
- **판정**: `logDt` 가 23자 `YYYY-MM-DD HH:MI:SS.SSS` 이고 보낸 순간(앞뒤 1초)의 KST 다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-api/request.test.js::IA-02`

### IA-03. result 가 없으면 최상위의 같은 이름을 읽는다

- **등급**: 일반
- **겨누는 조항**: 표면 — 응답 「result 가 없으면 같은 이름이 최상위에 있다」
- **판정**: 최상위에 `recptnRsltCd` AP1002 · `recptnRslt` 가 있는 응답 → `stored` · AP1002 · 그 문구, 최상위 AP1027 → `error_response` · AP1027.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-api/request.test.js::IA-03`

### IA-04. AP1002 가 아닌 결과 코드는 모두 오류 응답이다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 결과 코드 표 · 「그 밖의 코드도 AP1002 가 아니면 모두 오류 응답이다」
- **판정**: AP1027 · AP1029 · AP1003 · AP1011 · AP1030 · AP1031 · AP1032 와 표에 없는 AP1099 · AP9999 응답은 각각 `error_response` 이고 `resultCode` 가 그 코드다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-api/request.test.js::IA-04`
