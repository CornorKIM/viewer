# step-sender — 게이트

> 계약: `docs/spec/sf-daily/spec/step-sender.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 부르는 표면: `sendStep(request)`(`docs/spec/sf-daily/api/step-sender.md`) · 로그수집 API 는 같은 주소의 가짜 HTTPS 서버 · 전송 이력은 버리는 PostgreSQL 의 같은 모양 테이블
> 실제 시계로 돈다 — 「그날」 은 시험을 돌리는 때의 KST 날짜다. 다른 쓰는 쪽(뷰어 · Vercel)의 행은 시험이 직접 넣는다.

## 명제

### SS-01. 요청의 그날이 지금의 KST 날짜와 다르면 지난 날

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 1 · 4절 결과 표 「지난 날 — 이력 행 없음」
- **판정**: 어제 · 내일 날짜로 요청하면 `past_day` 이고 로그수집 API 에 요청이 없고 이력 행이 늘지 않는다.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-01`

### SS-02. 지금이 보내는 범위의 끝 시각 이후면 범위 지남

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 2 · 4절 결과 표
- **판정**: `windowEnd` 가 1초 전이면 `window_passed`, 요청 없음, 이력 행 없음.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-02`

### SS-03. 앞 단계의 그날 정상 저장 건수가 0 이면 앞 단계 없음

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 3 · 「그날 정상 저장 건수는 interfaces/sf-log-history.md 가 정한 셈이다」
- **판정**: 로그인 없는 조회, 로그인만 있고 조회 없는 로그아웃, 앞 단계가 AP1029 · 시험(test) · DO6999 행뿐인 조회는 `previous_missing`, 요청 없음, 이력 행 없음.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-03`

### SS-04. 로그인 단계는 앞 단계 확인에 걸리지 않는다

- **등급**: 핵심
- **겨누는 조항**: 1절 「로그인 단계는 확인 3 에 걸리지 않는다」
- **판정**: 이력이 빈 업체의 로그인은 보내져 `stored` 이고 요청이 하나 간다.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-04`

### SS-05. 이 단계의 그날 정상 저장 건수가 1 이상이면 이미 저장됨

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 4
- **판정**: 그날 30분 전에 저장된 로그인이 있으면 로그인 요청은 `already_stored`, 앞 단계가 다 있고 로그아웃도 저장돼 있으면 로그아웃 요청도 `already_stored`. 요청 없음, 이력 행 없음.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-05`

### SS-06. 그날 정상 저장 건수는 모든 쓰는 쪽의 행을 센다

- **등급**: 핵심
- **겨누는 조항**: 1절 「자동 전송 · 뷰어 화면 로그인 · Vercel 쪽 전송을 모두 센다」
- **판정**: 유형1 의 `source` 가 `login` · `sensor` 인 행, 유형2-3 의 자동 전송 표시 없는 행이 그날 AP1002 로 있으면 그 단계는 `already_stored`.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-06`

### SS-07. 가장 최근 요청이 10분 안이면 10분 대기

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 5 · 「확인 5 의 「요청을 보낸 지」 는 전송 이력에 남은 그 업체의 가장 최근 행으로 잰다」
- **판정**: 그 업체의 가장 큰 `sent_at` 이 5분 전 시험 행 · 3분 전 전송 실패 행 · (id 가 더 작아도) 4분 전 AP1029 행이면 `wait_10min`, 요청 없음, 이력 행 없음.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-07`

### SS-08. 다른 업체의 최근 요청과 10분이 지난 요청은 막지 않는다

- **등급**: 핵심
- **겨누는 조항**: 1절 확인 표 순서 5(「이 업체로」)
- **판정**: 다른 업체의 1분 전 행과 이 업체의 11분 전 행만 있으면 로그인은 보내져 `stored`.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-08`

### SS-09. 확인 순서는 1 → 2 → 3 → 4 → 5 다

- **등급**: 핵심
- **겨누는 조항**: 1. 보내기 전에 다섯 가지를 이 순서로 확인한다
- **판정**: 둘 이상 걸리는 요청은 앞 순서의 결과다 — 어제 · 범위 지남 · 이미 저장 → `past_day` · 범위 지남 · 앞 단계 없음 → `window_passed` · 앞 단계 없음 · 이미 저장 → `previous_missing` · 이미 저장 · 10분 안 → `already_stored` · 앞 단계 없음 · 10분 안 → `previous_missing`.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-09`

### SS-10. 보내는 로그의 값

- **등급**: 핵심
- **겨누는 조항**: 2. 보내는 로그의 값은 이 표로 정해진다
- **판정**: 요청의 `crtfcKey` 는 그 업체 인증키, `logDt` 는 `YYYY-MM-DD HH:MI:SS.SSS` 로 보낸 순간(앞뒤 1초)의 KST 이고 날짜가 그날, `useSe` 는 단계 코드, `sysUser` 는 명부 값, `conectIp` 는 `SF_LOG_DEFAULT_IP`, `dataUsgqty` 는 0.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-10`

### SS-11. SF_LOG_DEFAULT_IP 가 없으면 접속 IP 는 175.193.55.102

- **등급**: 일반
- **겨누는 조항**: 입력 — 설정 `SF_LOG_DEFAULT_IP`(기본값)
- **판정**: 설정이 없는 프로세스가 보낸 요청의 `conectIp` 가 175.193.55.102.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-11`

### SS-12. 같은 단계는 동시에 두 번 나가지 않는다

- **등급**: 핵심
- **겨누는 조항**: 3. 같은 단계는 동시에 두 번 나가지 않는다
- **판정**: 같은 업체 · 그날 · 단계 요청을 한 프로세스에서 둘, 다른 프로세스에서 하나 동시에 보내면(API 응답 0.8초 지연) 로그수집 API 요청은 하나, 결과는 `stored` 하나와 나머지 `in_progress` 또는 `already_stored`.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-12`

### SS-13. AP1002 는 정상 저장, 그 밖의 코드는 오류 응답

- **등급**: 핵심
- **겨누는 조항**: 4절 결과 표 「정상 저장」 · 「오류 응답」 · 출력 1 「보냈으면 사업관리시스템의 결과 코드」
- **판정**: 응답 코드 AP1002 → `stored` · `resultCode` AP1002 · `message` 는 응답 문구, AP1029 → `error_response` · AP1029 · 그 문구.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-13`

### SS-14. 닿지 못했거나 응답을 읽지 못하면 전송 실패

- **등급**: 핵심
- **겨누는 조항**: 4절 결과 표 「전송 실패 — 이력 행 남김」
- **판정**: 연결 거부 · 결과 코드를 읽을 수 없는 HTTP 502 HTML 본문 · 응답 전 연결 끊김 → `send_failed`, `resultCode` null, `message` 는 문자열, 그 업체 이력 행 하나(`result_code` null, `error` 에 사유).
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-14`

### SS-15. 보낸 요청 하나마다 이력 한 행에 보낸 값과 응답이 남는다

- **등급**: 핵심
- **겨누는 조항**: 출력 2 「그 요청 하나마다 이력 한 행. 보내지 않은 결과는 이력에 행을 남기지 않는다」
- **판정**: A · B(오류 응답) · CDR 로그인 뒤 업체마다 행 하나 — `use_se` · `log_dt`(보낸 값과 같음) · `sys_user` · `conect_ip` · `data_usgqty` 0 · `test` 거짓 · `result_code`(결과와 같음) · `http_status` 200 · `sent_at` 의 KST 날짜가 그날 · 업체 열. 이어 보내지 않은 결과는 행을 더하지 않는다.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-15`

### SS-16. 인증키는 이력 행과 보내기 결과에 없다

- **등급**: 핵심
- **겨누는 조항**: 4절 「이력 행에는 인증키를 남기지 않는다」
- **판정**: 정상 저장 · 오류 응답 · 전송 실패 뒤 두 이력 테이블의 모든 행 · 모든 열과 세 결과 객체 어디에도 인증키 · 비밀번호 값이 없다.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-16`

### SS-17. 로그 일시의 날짜는 요청의 그날이다

- **등급**: 핵심
- **겨누는 조항**: 2절 「로그 일시의 날짜는 요청의 그날과 같다」
- **판정**: 로그인 · 조회 · 로그아웃 요청 셋의 `logDt` 날짜가 모두 그날이고 사용 구분이 차례로 DO6001 · DO6003 · DO6002.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-17`

### SS-18. 자동 전송이 남긴 행은 자동 전송으로 구별된다

- **등급**: 핵심
- **겨누는 조항**: 4절 「자동 전송이 남긴 행은 이력에서 자동 전송으로 구별된다」
- **판정**: IH-04 와 같은 시험 — 유형1 행은 `source` 가 `auto`, 유형2-3 행의 id 는 전용 DB 에 있다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-history/history.test.js::IH-04`
