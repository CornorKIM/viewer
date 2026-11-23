# 하루 계획 이음새 — 게이트

> 계약: `docs/spec/sf-daily/api/daily-plan.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 「같은 date 는 같은 값」 · 「동시에 불러도 같다」 는 `tests/sf-daily/daily-plan/GATES.md` 의 DP-06 · DP-08 이 잰다.

## 명제

### ADP-01. 돌려받는 값의 모양

- **등급**: 핵심
- **겨누는 조항**: 표면(필드 표) · 불변식 「한 번 돌려준 값은 … 초 단위로 같다」 · companies 출력 1 「순서는 표의 순서다」
- **판정**: `date` 는 요청한 문자열, `companies` 는 코드가 A · B · C · D · CDR 순서인 다섯 항목, 각 `login` · `query` · `logout` 은 유효한 `Date` 이고 밀리초가 0 이다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/daily-plan/surface.test.js::ADP-01`

### ADP-02. 시각은 그날 KST 안에 있고 login < query < logout

- **등급**: 핵심
- **겨누는 조항**: 불변식 「시각은 모두 그날 KST 날짜 안에 있다」 · 「login < query < logout 이다」
- **판정**: 여러 그날(연초 · 2월 말 · 연말)의 모든 시각이 그날 KST 00:00 이상 다음 날 00:00 미만이고 업체마다 `login < query < logout`.
- **구현 상태**: 미구현 — `tests/sf-daily/api/daily-plan/surface.test.js::ADP-02`

### ADP-03. 형식이 틀리거나 없는 날짜면 TypeError 로 거부한다

- **등급**: 일반
- **겨누는 조항**: 오류 — 「date 가 YYYY-MM-DD 가 아니거나 없는 날짜 → Promise 거부(TypeError)」
- **판정**: 없는 날(2월 30일 · 13월 · 0월) · 구분자 없음 · 한 자리 월일 · 빈 문자열 · undefined · null · 숫자 · Date 를 주면 TypeError 로 거부한다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/daily-plan/surface.test.js::ADP-03`

### ADP-04. DB 에 닿지 못하면 Error 로 거부한다

- **등급**: 일반
- **겨누는 조항**: 오류 — 「DB 에 닿지 못함 · 쿼리 실패 → Promise 거부(Error)」
- **판정**: `SF_DB_URL` 이 닿지 않는 주소인 프로세스에서 부르면 Error 로 거부하고, 그 오류는 부르는 쪽 결함을 뜻하는 TypeError 가 아니다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/daily-plan/surface.test.js::ADP-04`

### ADP-05. 정한 적 없는 지난 날짜는 새로 정하고 그 뒤로 유지한다

- **등급**: 일반
- **겨누는 조항**: 순서 · 중복 「지난 날짜를 불러도 그날 정했던 계획이 돌아오고, 정한 적이 없으면 새로 정한다」
- **판정**: 정한 적 없는 지난 그날을 부르면 계획이 돌아오고, 다시 부르면 같은 계획이다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/daily-plan/surface.test.js::ADP-05`
