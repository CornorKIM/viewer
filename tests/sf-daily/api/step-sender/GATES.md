# 단계 보내기 이음새 — 게이트

> 계약: `docs/spec/sf-daily/api/step-sender.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 결과 값 하나하나의 뜻은 `tests/sf-daily/step-sender/GATES.md` 가 잰다. 같은 자리를 재는 그 시험은 이름에 이 파일의 ID 를 함께 단다.

## 명제

### ASS-01. 결과는 outcome · resultCode · message 다

- **등급**: 핵심
- **겨누는 조항**: 표면 — 결과 표 · 결과 값 표
- **판정**: 아홉 값 중 여덟(정상 저장 · 오류 응답 · 전송 실패 · 지난 날 · 범위 지남 · 앞 단계 없음 · 이미 저장됨 · 10분 대기)을 차례로 끌어내면 각 결과가 그 `outcome` 이고, `resultCode` · `message` 는 문자열 또는 null, 보내지 않았거나 응답이 없는 결과의 `resultCode` 는 null, 정상 저장 · 오류 응답의 `resultCode` 는 응답 코드다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/step-sender/surface.test.js::ASS-01`

### ASS-02. 필드가 없거나 값이 표 밖이면 TypeError

- **등급**: 일반
- **겨누는 조항**: 오류 — 「요청 필드가 없거나 값이 표 밖 → Promise 거부(TypeError)」
- **판정**: 요청 없음 · 빈 객체 · 업체 없음 / 명부 밖(Z) · 날짜 없음 / 형식 틀림 / 없는 날 · 단계 없음 / 표 밖(LOGIN) · `windowEnd` 없음 / 문자열 / 잘못된 Date 는 TypeError 로 거부하고 로그수집 API 에 아무것도 가지 않는다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/step-sender/surface.test.js::ASS-02`

### ASS-03. 전송 이력 DB 에 닿지 못하면 Error 로 거부하고 보내지 않는다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「DB 에 닿지 못해 확인을 못 함 → Promise 거부(Error)」
- **판정**: `PG_HOST` 가 닿지 않는 프로세스의 로그인 요청은 TypeError 가 아닌 Error 로 거부되고 로그수집 API 에 요청이 없다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/step-sender/surface.test.js::ASS-03`

### ASS-04. 사업관리시스템 오류 · 닿지 못함은 정상 결과다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「사업관리시스템 오류 · 닿지 못함 → 정상 결과(error_response · send_failed)」
- **판정**: AP1027 응답은 `error_response`, 연결 끊김은 `send_failed` 로 거부 없이 돌아온다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/step-sender/surface.test.js::ASS-04`

### ASS-05. 같은 요청이 동시에 와도 나가는 로그는 하나다

- **등급**: 핵심
- **겨누는 조항**: 순서 · 중복 첫 항
- **판정**: SS-12 와 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-12`

### ASS-06. 결과 어디에도 인증키가 없다

- **등급**: 핵심
- **겨누는 조항**: 불변식 「결과 어디에도 인증키가 없다」 · 결과 표 `message` 「인증키를 담지 않는다」
- **판정**: SS-16 과 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-16`

### ASS-07. 보낸 결과일 때만 요청이 나갔고 요청마다 이력 한 행이 있다

- **등급**: 핵심
- **겨누는 조항**: 불변식 첫 항
- **판정**: SS-15 와 같은 시험(보내지 않은 결과의 「요청 없음 · 행 없음」 은 SS-01 ~ SS-09).
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-15`

### ASS-08. 보낸 로그의 로그 일시 날짜는 date 와 같다

- **등급**: 핵심
- **겨누는 조항**: 불변식 둘째 항
- **판정**: SS-17 과 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-17`

### ASS-09. 단계 순서가 뒤집혀 와도 앞 단계가 없으면 previous_missing

- **등급**: 일반
- **겨누는 조항**: 순서 · 중복 둘째 항
- **판정**: SS-03 과 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-03`
