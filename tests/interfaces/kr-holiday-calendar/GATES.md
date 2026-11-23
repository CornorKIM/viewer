# 휴일 달력(제품 밖 · 읽기 전용) — 게이트

> 계약: `docs/spec/interfaces/kr-holiday-calendar.md`
> 구현: 이 폴더 · 시험 결속 규약: `tests/lib/README.md`
> 우리 쪽(business-day)이 이 달력을 어떻게 읽어야 하는지만 잰다. 달력은 가짜 HTTPS 서버가 같은 주소로 흉내 낸다.
> 응답 코드 · 5초 · 형식 오류의 분류는 `tests/sf-daily/business-day/GATES.md` 의 BD-10 · BD-11 · BD-13 이 잰다.

## 명제

### IC-01. 계약의 공개 iCal 주소를 키 없이 GET 한다

- **등급**: 핵심
- **겨누는 조항**: 표면 — 요청
- **판정**: `SF_HOLIDAY_CALENDAR_URL` 이 없거나 비면 `calendar.google.com` 의 `/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics` 로 GET 이 한 번 이상 가고, 그 응답으로 판단한다.
- **구현 상태**: 미구현 — `tests/interfaces/kr-holiday-calendar/calendar.test.js::IC-01`

### IC-02. 접힌 속성 줄을 이어 읽는다

- **등급**: 일반
- **겨누는 조항**: 표면 — 「긴 속성 줄은 CRLF 다음 공백 하나로 이어진다」
- **판정**: 모든 줄이 접힌 달력에서 긴 `SUMMARY` 의 공휴일은 이어 붙인 전체 이름이 `holidayName` 이고, 접힌 「기념일」 설명의 평일은 영업일이다.
- **구현 상태**: 미구현 — `tests/interfaces/kr-holiday-calendar/calendar.test.js::IC-02`

### IC-03. 일정 날짜는 시간대 변환 없이 한국 날짜다

- **등급**: 핵심
- **겨누는 조항**: 불변식 — 「일정 날짜는 한국 날짜다(시간대 변환 없음)」
- **판정**: `DTSTART;VALUE=DATE` 가 어느 수요일인 공휴일은 그 수요일 KST 00:30(UTC 로는 전날) 판단에서 쉬는 날이고, 전날 KST 23:30 판단에는 번지지 않는다.
- **구현 상태**: 미구현 — `tests/interfaces/kr-holiday-calendar/calendar.test.js::IC-03`
