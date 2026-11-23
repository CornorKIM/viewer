# 현황 메일 보내기 이음새 — 게이트

> 계약: `docs/spec/sf-daily/api/status-mail.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 같은 자리를 재는 `tests/sf-daily/status-mail/` 의 시험은 이름에 이 파일의 ID 를 함께 단다.

## 명제

### ASM-01. missingLogin 은 로그인 0 인 업체 코드를 명부 순서로 담는다

- **등급**: 핵심
- **겨누는 조항**: 표면 — `missingLogin`
- **판정**: B · D 의 로그인이 0 인 그날의 `sent` 결과에서 `missingLogin` 이 B, D 순서의 배열이다(SM-05 의 시험 · 없으면 빈 배열은 SM-07).
- **구현 상태**: 미구현 — `tests/sf-daily/status-mail/mail.test.js::SM-05`

### ASM-02. 같은 date 로 동시에 불러도 메일은 한 통

- **등급**: 핵심
- **겨누는 조항**: 순서 · 중복
- **판정**: 한 프로세스 안의 두 호출과 다른 프로세스의 한 호출이 같은 그날을 동시에 부르면 결과가 `sent` 하나 · `already_sent` 둘이고 메일 서버가 받은 메일은 하나.
- **구현 상태**: 미구현 — `tests/sf-daily/api/status-mail/surface.test.js::ASM-02`

### ASM-03. DB 에 닿지 못하면 failed 로 돌아온다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「DB 에 닿지 못함 → outcome: failed」
- **판정**: `SF_DB_URL` 이 닿지 않는 프로세스, `PG_HOST` 가 닿지 않는 프로세스 모두 거부 없이 `outcome: failed` 와 문자열 `error` 를 돌려준다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/status-mail/surface.test.js::ASM-03`

### ASM-04. date 형식이 틀리면 TypeError

- **등급**: 일반
- **겨누는 조항**: 오류 — 「date 형식이 틀림 → Promise 거부(TypeError)」
- **판정**: 13월 · 2월 30일 · 구분자 없음 · 빈 문자열 · undefined · null · Date 를 주면 TypeError 로 거부하고 메일이 나가지 않는다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/status-mail/surface.test.js::ASM-04`

### ASM-05. sent 를 돌려준 date 는 언제나 already_sent

- **등급**: 핵심
- **겨누는 조항**: 불변식 첫 항
- **판정**: SM-12 와 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/status-mail/mail.test.js::SM-12`

### ASM-06. failed 를 돌려준 date 는 보낸 것으로 기록되지 않는다

- **등급**: 핵심
- **겨누는 조항**: 불변식 둘째 항
- **판정**: SM-14 와 같은 시험.
- **구현 상태**: 미구현 — `tests/sf-daily/status-mail/mail.test.js::SM-14`

### ASM-07. error 는 failed 일 때 사유 문자열이고 비밀번호를 담지 않는다

- **등급**: 핵심
- **겨누는 조항**: 표면 — `error` 「failed 일 때 사유. 비밀번호를 담지 않는다」
- **판정**: 인증 거부의 `failed` 결과는 `error` 가 비지 않은 문자열이고 `SMTP_PASS` 를 담지 않으며, 이어진 `sent` 결과의 `error` 는 null, 두 결과의 `missingLogin` 은 문자열 배열이다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/status-mail/surface.test.js::ASM-07`
