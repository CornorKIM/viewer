# 전송 이력 — 게이트

> 계약: `docs/spec/interfaces/sf-log-history.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> sf-daily 쪽(step-sender 쓰기 · 읽기, status-mail 읽기)이 이 이음새에서 지켜야 할 것만 잰다. 테이블은 `api/_sf-history.js` · `api/_tp1.js` 와 같은 DDL 로 버리는 PostgreSQL 에 만든 사본이다.

## 명제

### IH-01. sf-daily 는 이력 DB 의 스키마를 만들거나 바꾸지 않는다

- **등급**: 핵심
- **겨누는 조항**: 「이 DB 에 스키마 · 테이블 · 열을 새로 만들거나 바꾸지 않는다」
- **판정**: 단계 보내기 · 하루 계획 · 현황 메일을 돌리기 전과 뒤의 이력 DB 스키마 · 관계 · 열(타입 · 기본값) · 인덱스 목록이 같다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-history/history.test.js::IH-01`

### IH-02. 정상 저장 건수의 셈

- **등급**: 핵심
- **겨누는 조항**: 정상 저장 건수 — 이 셈이 정본이다
- **판정**: 현황 메일 건수가 업체 열 · `sent_at` 의 Asia/Seoul 날짜(KST 자정 경계 포함) · `use_se` · AP1002 · 시험 아님을 모두 만족하는 행 수다(SM-03 의 시험). 단계 보내기의 「이미 저장됨」 · 「앞 단계 없음」 도 같은 셈이다(SS-03 · SS-05 · SS-06).
- **구현 상태**: 미구현 — `tests/sf-daily/status-mail/mail.test.js::SM-03`

### IH-03. 유형2-3 행의 equipment_no 는 명부의 장비 번호다

- **등급**: 핵심
- **겨누는 조항**: 「sf-daily 가 쓰는 유형2-3 행의 equipment_no 는 업체 명부의 그 업체 장비 번호다」
- **판정**: CO-05 와 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/companies/roster.test.js::CO-05`

### IH-04. 자동 전송 행의 구별

- **등급**: 핵심
- **겨누는 조항**: 자동 전송 행은 이렇게 구별된다
- **판정**: 자동 전송한 유형1 행의 `source` 가 `auto` 이고, 자동 전송한 유형2-3 행의 id 가 전용 DB 의 어느 표의 정수 · 문자 열에 그대로 있으며, 시험이 넣은 뷰어 행의 id 는 전용 DB 어디에도 없다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-history/history.test.js::IH-04`

### IH-05. 업체의 가장 최근 요청은 가장 큰 sent_at 이다

- **등급**: 핵심
- **겨누는 조항**: 업체의 가장 최근 요청 · 불변식 「sent_at 은 쓴 순서대로 커진다고 가정하지 않는다」
- **판정**: SS-07 과 같은 시험(시험 · 오류 행 포함, id 순서와 무관).
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-07`

### IH-06. 행은 더하기만 한다

- **등급**: 핵심
- **겨누는 조항**: 순서 · 중복 「행은 쌓이기만 한다. 고치거나 지우지 않는다」
- **판정**: 미리 넣은 행(정상 · 시험 · 오류 · 전송 실패)은 단계 보내기들이 끝난 뒤에도 모든 열이 그대로이고 행은 늘기만 한다.
- **구현 상태**: 미구현 — `tests/interfaces/sf-log-history/history.test.js::IH-06`

### IH-07. 행의 어느 열에도 인증키가 없다

- **등급**: 핵심
- **겨누는 조항**: 불변식 「행의 어느 열에도 인증키가 없다」
- **판정**: SS-16 과 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/step-sender/send.test.js::SS-16`
