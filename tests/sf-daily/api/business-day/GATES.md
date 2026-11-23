# 영업일 판단 이음새 — 게이트

> 계약: `docs/spec/sf-daily/api/business-day.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`

## 명제

### ABD-01. 돌려받는 값은 네 필드이고 사유 표와 null 규칙을 지킨다

- **등급**: 핵심
- **겨누는 조항**: 표면(필드 표 · 사유 값 표) · 불변식 「date 는 at 의 UTC+9 날짜다」 · 「result 가 business 이면 reason 과 holidayName 은 null 이다」
- **판정**: 영업일 · 쉬는 날(토요일 · 5월 1일 · 공휴일) · 확인 불가 · 자정 직전의 판단 모두 `date`(`at` 의 UTC+9 날짜) · `result`(셋 중 하나) · `reason`(사유 표의 값이고 그 `result` 짝이 맞다, `business` 이면 null) · `holidayName`(`holiday` 일 때만 문자열, 그 밖에 null)을 가진다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/business-day/surface.test.js::ABD-01`

### ABD-02. at 이 유효한 Date 가 아니면 TypeError

- **등급**: 일반
- **겨누는 조항**: 오류 — 「at 이 유효한 Date 가 아님 → 예외(TypeError)」
- **판정**: 잘못된 Date · 문자열 · 숫자 · undefined · null · 객체를 주면 TypeError 를 던지거나 TypeError 로 거부한다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/business-day/surface.test.js::ABD-02`

### ABD-03. 달력 문제로 예외를 던지지 않는다

- **등급**: 핵심
- **겨누는 조항**: 오류 — 「달력 문제로 예외를 던지지 않는다. 달력 문제는 언제나 unknown 으로 돌아온다」
- **판정**: 달력이 500 · 엉뚱한 본문 · 연결 끊김 · 깨진 VEVENT · 닿지 않음일 때 평일 판단은 거부 없이 `result: unknown` 으로 돌아온다.
- **구현 상태**: 미구현 — `tests/sf-daily/api/business-day/surface.test.js::ABD-03`
