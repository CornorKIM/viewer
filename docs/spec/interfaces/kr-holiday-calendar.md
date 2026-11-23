# 휴일 달력

> 방향: 휴일 달력 → sf-daily(business-day)
> 소유: 제품 밖 · 종류: 「제품 밖 · 읽기 전용」(출처: 구글 캘린더 공개 달력 「대한민국의 휴일」)
> 상태: 동결

우리가 기대는 부분만 적는다. 원문과 충돌하면 원문이 이긴다.

## 목적

한국의 공휴일 일정을 iCalendar 로 받는다.

## 표면

요청: `GET https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics` (키 없음).

응답: `text/calendar`, UTF-8. `BEGIN:VCALENDAR` 로 시작한다. 일정마다 `BEGIN:VEVENT` ~ `END:VEVENT` 사이에:

| 속성 | 뜻 |
|---|---|
| `DTSTART;VALUE=DATE:YYYYMMDD` | 일정 날짜(하루짜리) |
| `SUMMARY` | 일정 이름(예: 「설날」 · 「쉬는 날 개천절」 · 「지방선거일」) |
| `DESCRIPTION` | 「공휴일」 이면 공휴일, 「기념일」 로 시작하면 기념일 |

긴 속성 줄은 CRLF 다음 공백 하나로 이어진다(iCalendar 줄 접기).

## 오류

| 조건 | 우리 쪽 |
|---|---|
| 닿지 못함 · HTTP 200 이 아님 · 5초 초과 | 달력 받기 실패 |
| `BEGIN:VCALENDAR` 가 없음 · VEVENT 를 하나도 못 읽음 | 달력 형식 오류 |

## 불변식

- 대체공휴일 · 선거일 · 임시공휴일은 설명이 「공휴일」 인 일정으로 들어온다.
- 일정 날짜는 한국 날짜다(시간대 변환 없음).
