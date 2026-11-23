# 2026-11-23 — 외부 조건 확인 (영업일 자동 전송 · 23시 메일)

자동 전송과 현황 메일이 기대는 외부 것이 이 서버(Docker, twin.smartline.kr)에서 실제로 되는지 확인했다.

## 되는 것

- **사업관리시스템 로그수집 API** (`https://log.smart-factory.kr/apisvc/sendLogData.json`, POST form) — 다섯 업체 키로 로그인(DO6001)을 동시에 보내 다섯 건 모두 AP1002(정상 저장). 10분 저장 제한은 업체(키)별이다. 보낸 것을 조회하는 API는 없다(연동가이드 v1.6 · 규격서 v1.7). 당일이 아닌 로그 일시는 AP1027로 거절된다.
- **구글 캘린더 「대한민국의 휴일」 공개 iCal** (`https://calendar.google.com/calendar/ical/ko.south_korea%23holiday%40group.v.calendar.google.com/public/basic.ics`) — 키 없이 받아진다. 일정 280개, 2021~2031년. 일정마다 DESCRIPTION 이 「공휴일」 또는 「기념일…」. 대체공휴일은 「쉬는 날 ○○」 이름의 공휴일, 선거일(지방선거일) · 노동절도 공휴일로 들어 있다.
- **Gmail SMTP** (`smtp.gmail.com:587`, STARTTLS, 앱 비밀번호) — smart-line2 와 같은 계정으로 로그인 성공(235). 메일은 보내지 않았다.
- **공유 PostgreSQL 전송 이력** (`tp23.sf_log_history`, `tp1.sf_log_history`) — 우리 컨테이너에서 읽고 쓴다. Vercel 쪽 전송도 같은 테이블에 기록한다.

## 안 되는 것

- 없음.

## 아직 모르는 것

- 구글 달력에 임시공휴일이 지정 후 얼마 만에 올라오는지 — 비공식 출처라 보장이 없다. 대안: 공공데이터포털 특일정보 API(키 필요)로 바꿀 수 있도록 휴일 출처를 이음새 하나로 둔다.
- Gmail 하루 발송 한도 · 스팸 분류 — 하루 한 통이라 걸릴 가능성은 낮다.

## 대안

- 휴일 출처: 공공데이터포털 특일정보 API (기존 코드에 판단 로직이 있다).
- 메일: Resend(API 키 필요, 기존 KPI 보고 코드가 쓴다).
