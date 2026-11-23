# 메일 서버(제품 밖 · 읽기 전용) — 게이트

> 계약: `docs/spec/interfaces/smtp-mail.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 우리 쪽(status-mail)이 메일 서버와 어떻게 주고받아야 하는지만 SMTP 스텁에서 잰다. 스텁은 시험용 인증서로 STARTTLS 를 한다.

## 명제

### IM-01. STARTTLS 뒤 SMTP_USER · SMTP_PASS 로 인증하고 SMTP_USER 로 보낸다

- **등급**: 핵심
- **겨누는 조항**: 표면 — 접속 · 보내는 사람
- **판정**: `SMTP_PORT` 가 없을 때 587 번 스텁이 메일을 받고, 그 세션에서 STARTTLS 가 AUTH 보다 먼저이며 AUTH 는 TLS 위에서 `SMTP_USER` · `SMTP_PASS` 로, MAIL FROM 과 From 머리는 `SMTP_USER`.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-01`

### IM-02. SMTP_PORT 를 주면 그 포트로 붙는다

- **등급**: 일반
- **겨누는 조항**: 표면 — 접속 `SMTP_HOST`:`SMTP_PORT`
- **판정**: `SMTP_PORT` 2525 인 프로세스의 메일은 2525 번 스텁이 받고 587 번 스텁은 받지 않는다.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-02`

### IM-03. UTF-8 HTML 본문과 UTF-8 제목

- **등급**: 핵심
- **겨누는 조항**: 표면 — 「메일: UTF-8 HTML 본문, 제목 UTF-8」
- **판정**: 받은 메일에 charset utf-8 인 text/html 부분이 있고 거기서 한글 업체 이름이 읽히며, 제목이 한글 「스마트공장 로그 현황」 으로 풀린다.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-03`

### IM-04. STARTTLS 를 못 하면 실패 — 인증 정보를 평문으로 보내지 않는다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「접속 · STARTTLS · 인증 실패 → 실패」
- **판정**: STARTTLS 를 알리지 않는 서버에는 `failed` 이고 메일이 없으며, TLS 없이 비밀번호를 담은 AUTH 가 오지 않는다.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-04`

### IM-05. 인증이 거부되면 실패

- **등급**: 핵심
- **겨누는 조항**: 오류 — 인증 실패
- **판정**: AUTH 에 535 를 주면 `failed` 이고 메일이 없다.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-05`

### IM-06. 받는 사람 중 하나라도 거부되면 실패

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「받는 사람 중 하나라도 거부 → 실패」
- **판정**: 두 받는 사람 중 하나의 RCPT 에 550 을 주면 `failed`.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-06`

### IM-07. DATA 를 받아들였을(250) 때만 보낸 것이다

- **등급**: 핵심
- **겨누는 조항**: 불변식 「서버가 DATA 를 받아들였으면(250) 보낸 것이다」
- **판정**: DATA 끝에 554 를 주면 `failed`, 이어 250 을 주면 같은 그날이 `sent`.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-07`

### IM-08. 메일 서버에 닿지 못하면 실패

- **등급**: 핵심
- **겨누는 조항**: 오류 — 접속 실패
- **판정**: 아무도 듣지 않는 포트를 `SMTP_PORT` 로 준 프로세스의 결과는 `failed`.
- **구현 상태**: 미구현 — `tests/interfaces/smtp-mail/smtp.test.js::IM-08`
