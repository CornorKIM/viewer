# business-day — 게이트

> 계약: `docs/spec/sf-daily/spec/business-day.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 부르는 표면: `judgeBusinessDay(at)`(`docs/spec/sf-daily/api/business-day.md`) · 달력은 가짜 HTTPS 서버

## 명제

### BD-01. 그날은 판단 시점의 KST 날짜다

- **등급**: 핵심
- **겨누는 조항**: 1. 그날은 한국 시간 날짜 하나다
- **판정**: UTC 15:00:00.000 인 시점의 `date` 는 다음 날짜이고, UTC 14:59:59.999 인 시점의 `date` 는 같은 날짜다(연말을 넘는 경우 포함).
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-01`

### BD-02. 토요일은 쉬는 날, 사유 토요일

- **등급**: 핵심
- **겨누는 조항**: 3. 쉬는 날의 사유는 넷이고 이 표가 그 정본이다
- **판정**: 토요일 KST 시점 → `result: off` · `reason: saturday` · `holidayName: null`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-02`

### BD-03. 일요일은 쉬는 날, 사유 일요일

- **등급**: 핵심
- **겨누는 조항**: 3. 쉬는 날의 사유는 넷이고 이 표가 그 정본이다
- **판정**: 일요일 KST 시점 → `off` · `sunday` · `holidayName: null`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-03`

### BD-04. 평일 5월 1일은 쉬는 날, 사유 5월 1일

- **등급**: 핵심
- **겨누는 조항**: 3. 쉬는 날의 사유는 넷이고 이 표가 그 정본이다
- **판정**: 평일인 5월 1일 → `off` · `may_first` · `holidayName: null`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-04`

### BD-05. 사유는 표의 순서로 먼저 맞는 하나다

- **등급**: 일반
- **겨누는 조항**: 3. 쉬는 날의 사유는 넷이고 이 표가 그 정본이다(판단 순서)
- **판정**: 토요일인 5월 1일 → `saturday` · 일요일인 5월 1일 → `sunday` · 달력에 공휴일이 오른 토요일 → `saturday` · 달력에 공휴일이 오른 평일 5월 1일 → `may_first`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-05`

### BD-06. 토요일 · 일요일 · 5월 1일은 달력 없이 판단한다

- **등급**: 핵심
- **겨누는 조항**: 3절 「토요일 · 일요일 · 5월 1일은 휴일 달력 없이 판단한다」 · api 불변식 「토요일 · 일요일 · 5월 1일의 판단은 달력 상태와 무관하게 같다」
- **판정**: 달력이 HTTP 500 을 주거나 닿지 않을 때도 토요일 · 일요일 · 평일 5월 1일은 각각 `off` 와 제 사유다.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-06`

### BD-07. 달력의 「공휴일」 일정이 있는 평일은 쉬는 날, 사유 공휴일과 일정 이름

- **등급**: 핵심
- **겨누는 조항**: 3. 쉬는 날의 사유는 넷이고 이 표가 그 정본이다(사유 4)
- **판정**: 달력에 그날 `DESCRIPTION:공휴일` 일정이 있는 평일 → `off` · `holiday` · `holidayName` = 그 일정의 `SUMMARY`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-07`

### BD-08. 「기념일」 일정의 평일은 영업일이다

- **등급**: 핵심
- **겨누는 조항**: 3절 「설명이 「기념일」 인 일정은 쉬는 날의 사유가 아니다」
- **판정**: 그날 일정의 설명이 「기념일」 로 시작하는 평일(그해 자료 있음) → `business` · `reason: null` · `holidayName: null`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-08`

### BD-09. 대체공휴일 · 선거일 · 임시공휴일은 공휴일로 오르면 쉬는 날이다

- **등급**: 핵심
- **겨누는 조항**: 3절 「대체공휴일 · 임시공휴일 · 선거일은 달력에 공휴일로 오른 경우 사유 4 로 쉬는 날이다」
- **판정**: 설명이 「공휴일」 인 「쉬는 날 삼일절」 · 「지방선거일」 · 「임시공휴일」 일정의 평일 → 각각 `off` · `holiday` · 그 이름.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-09`

### BD-10. 달력이 정상 응답이 아니거나 닿지 않으면 달력 받기 실패

- **등급**: 핵심
- **겨누는 조항**: 4. 달력으로 확인하지 못하면 확인 불가다(달력 받기 실패)
- **판정**: 평일(5월 1일 아님)에 달력이 HTTP 500 · 404 를 주거나 연결이 거부되면 `unknown` · `calendar_fetch_failed` · `holidayName: null`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-10`

### BD-11. 5초 안에 끝나지 않은 달력 받기는 실패다

- **등급**: 핵심
- **겨누는 조항**: 4절 「달력 받기는 5초 안에 끝나지 않으면 실패다」
- **판정**: 달력이 7초 뒤에야 정상 응답하면 평일 판단은 `unknown` · `calendar_fetch_failed`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-11`

### BD-12. 5초 안에 끝난 달력 받기는 실패가 아니다

- **등급**: 일반
- **겨누는 조항**: 4절 「달력 받기는 5초 안에 끝나지 않으면 실패다」
- **판정**: 달력이 3초 뒤 정상 응답하면 공휴일 없는 평일 판단은 `business`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-12`

### BD-13. 정한 모양이 아닌 응답은 달력 형식 오류

- **등급**: 핵심
- **겨누는 조항**: 4. 달력으로 확인하지 못하면 확인 불가다(달력 형식 오류)
- **판정**: HTTP 200 이지만 `BEGIN:VCALENDAR` 가 없는 본문, 또는 VEVENT 가 하나도 없는 VCALENDAR → `unknown` · `calendar_format_error`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-13`

### BD-14. 그해 1월 1일 「공휴일」 이 없으면 그해 자료 없음

- **등급**: 핵심
- **겨누는 조항**: 4. 달력으로 확인하지 못하면 확인 불가다(그해 자료 없음)
- **판정**: 달력에 앞뒤 해의 1월 1일만 있거나 그해 1월 1일이 「기념일」 이면, 그해의 공휴일 없는 평일 → `unknown` · `year_missing`.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-14`

### BD-15. 평일 · 공휴일 아님 · 그해 자료 있음이면 영업일

- **등급**: 핵심
- **겨누는 조항**: 2. 결과는 셋이고 이 표가 그 정본이다 · 4절 「확인 불가는 영업일로 취급되지 않는다」
- **판정**: 그해 1월 1일 공휴일이 있고 그날 일정이 없는 평일 → `business` · `reason: null` · `holidayName: null`(확인 불가 · 쉬는 날은 `business` 가 아니다 — BD-02~BD-14).
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-15`

### BD-16. 판단마다 달력을 새로 받는다

- **등급**: 핵심
- **겨누는 조항**: 5. 판단마다 달력을 새로 받는다
- **판정**: 같은 평일을 두 번 판단하는 사이에 달력에 그날 임시공휴일을 올리면 첫 판단은 `business`, 둘째는 `off` · `holiday` · 「임시공휴일」 이고, 둘째 판단 때 달력 요청이 새로 들어온다.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-16`

### BD-17. SF_HOLIDAY_CALENDAR_URL 이 있으면 그 주소에서 받는다

- **등급**: 일반
- **겨누는 조항**: 입력 — 설정 `SF_HOLIDAY_CALENDAR_URL`
- **판정**: 다른 주소(HTTP 스텁)를 주면 그 주소에 GET 이 가고 그 달력의 공휴일로 판단하며 기본 주소에는 요청이 가지 않는다.
- **구현 상태**: 미구현 — `tests/sf-daily/business-day/business-day.test.js::BD-17`

### BD-18. SF_HOLIDAY_CALENDAR_URL 이 비면 기본 주소를 쓴다

- **등급**: 일반
- **겨누는 조항**: 입력 — 설정 `SF_HOLIDAY_CALENDAR_URL`(기본값)
- **판정**: 설정이 없거나 빈 문자열이면 `interfaces/kr-holiday-calendar.md` 의 주소로 GET 한다(IC-01 과 같은 시험).
- **구현 상태**: 미구현 — `tests/interfaces/kr-holiday-calendar/calendar.test.js::IC-01`
