# factory-3d-viewer — 아키텍처

> 상태: 살아있는 계약 · 독자: 설계자 / 오케스트레이터
> 각 노드의 계약은 INDEX 사슬로 찾는다. 이 문서는 경계와 흐름만 소유한다.

## 목적 / 의도

이 서버(twin.smartline.kr)에서 3D 공장 뷰어를 제공하고, 사업관리시스템 시험 기간 동안 다섯 업체의 사용 로그를 영업일마다 하루 한 번(로그인 · 조회 · 로그아웃) 사업관리시스템에 보낸다. 같은 단계를 그날 두 번 정상 저장시키지 않고, 지난 날짜의 로그를 보내지 않으며, 보낸 모든 건을 전송 이력에 남기고, 영업일 23시에 그날 현황을 메일로 알린다. 계약을 새로 쓰는 범위는 자동 전송과 현황 메일(`sf-daily`)이다. 뷰어(`viewer`)는 지금 코드가 정본이다.

## 제품 밖

- 사업관리시스템 로그수집 API — `interfaces/sf-log-api.md` 「제품 밖 · 읽기 전용」
- 구글 캘린더 「대한민국의 휴일」 공개 iCal — `interfaces/kr-holiday-calendar.md` 「제품 밖 · 읽기 전용」
- 메일 서버(SMTP) — `interfaces/smtp-mail.md` 「제품 밖 · 읽기 전용」

## 트리

```
factory-3d-viewer
├── [산출물] viewer — 3D 화면 · api/ 함수(센서 · 설비 · 화면 로그인 전송 · 이력 화면). 지금 코드가 정본
│   ═══ 이음새: 전송 이력 ═══ → interfaces/sf-log-history.md
└── [산출물] sf-daily — 영업일 자동 로그 전송과 23시 현황 메일(따로 도는 서비스 하나)
    ├── (모듈) companies — 업체 명부: 코드 · 유형 · 이름 · 인증키 자리 · 시스템 사용자 값 · 단계별 시각 범위
    ├── (모듈) business-day — 그날이 영업일인가(주말 · 공휴일 · 5월 1일), 확인할 수 없으면 영업일 아님
    ├── (모듈) daily-plan — 업체 · 그날마다 단계별 보낼 시각을 범위 안에서 한 번 정하고 다시 정하지 않음
    ├── (모듈) step-sender — 때가 된 단계 하나를 보냄: 그날 · 앞 단계 · 이미 정상 저장 여부 확인, 선점, 전송, 이력 기록
    ├── (모듈) status-mail — 그날 업체별 단계 정상 저장 건수 메일, 로그인 0 경고
    └── (모듈) runner — 설정 확인 · 켜고 끄기 · 시각에 따라 위 모듈을 부름
    (sf-daily 전용 DB — 하루 계획 · 자동 전송 표시 · 메일 기록. 같은 compose 의 PostgreSQL 컨테이너, sf-daily 만 쓴다)
    ═══ 이음새: 로그수집 API ═══ → interfaces/sf-log-api.md
    ═══ 이음새: 휴일 달력 ═══ → interfaces/kr-holiday-calendar.md
    ═══ 이음새: 메일 서버 ═══ → interfaces/smtp-mail.md
```

## 이음새

| 무엇 | 생산 → 소비 | 위치 | 계약 |
|---|---|---|---|
| 업체 명부(코드 · 유형 · 이름 · 키 자리 · 시스템 사용자 · 시각 범위) | companies → daily-plan, step-sender, status-mail | 산출물 안 | `sf-daily/spec/companies.md` |
| 영업일 판단 | business-day → runner | 산출물 안 | `sf-daily/api/business-day.md` |
| 그날 하루 계획 | daily-plan → runner | 산출물 안 | `sf-daily/api/daily-plan.md` |
| 단계 하나 보내기 요청과 결과 | runner → step-sender | 산출물 안 | `sf-daily/api/step-sender.md` |
| 현황 메일 보내기 요청과 결과 | runner → status-mail | 산출물 안 | `sf-daily/api/status-mail.md` |
| 휴일 일정 | 휴일 달력 → business-day | 제품 밖 | `interfaces/kr-holiday-calendar.md` |
| 로그 전송과 응답 | step-sender → 로그수집 API | 제품 밖 | `interfaces/sf-log-api.md` |
| 메일 발송 | status-mail → 메일 서버 | 제품 밖 | `interfaces/smtp-mail.md` |
| 전송 이력(쓰기 · 그날 정상 저장 건수 읽기) | viewer(소유) ↔ step-sender, status-mail | 산출물 사이 | `interfaces/sf-log-history.md` |

**순환 없음** — 방향 그래프: runner → {business-day, daily-plan, step-sender, status-mail}; daily-plan · step-sender · status-mail → companies; step-sender · status-mail → 전송 이력; business-day → 휴일 달력; step-sender → 로그수집 API; status-mail → 메일 서버. 되돌아오는 화살표가 없다.

## 공통 규칙

| 규칙 | 소유자(모듈 · 이음새) | 쓰는 곳 |
|---|---|---|
| 업체 목록 · 업체의 유형 · 이름 · 인증키 자리 · 시스템 사용자 값 · 단계별 시각 범위 | `sf-daily/spec/companies.md` | daily-plan, step-sender, status-mail |
| 그날(KST 날짜)과 영업일의 뜻 | `sf-daily/spec/business-day.md` | runner, daily-plan, step-sender, status-mail |
| 업체 · 그날 · 단계의 정상 저장 건수 | `interfaces/sf-log-history.md` | step-sender(이미 보냈는가), status-mail(건수) |
| 단계 코드(DO6001 · DO6003 · DO6002)와 결과 코드의 뜻 | `interfaces/sf-log-api.md` | step-sender, status-mail |

## 외부 통로

- `sf-daily` 가 로그수집 API로 나가는 자동 전송의 유일한 통로다. 뷰어 화면 로그인 전송은 `viewer` 가 따로 보낸다(지금 코드가 정본). 둘은 전송 이력으로만 서로를 안다.
- `sf-daily` 가 현황 메일의 유일한 통로다.
- 내부 구현 변경이 이 표면(보내는 로그의 모양 · 메일 내용)에 닿지 않게 하는 것이 `sf-daily` 의 책임이다.

## 문서 배치

배치 규칙은 PROJECT-LAYOUT.md 가 정한다. 이 절은 이 프로젝트의 산출물 폴더만 적는다.

| 산출물 폴더 | 코드 위치 |
|---|---|
| `sf-daily/` | `sf-daily/` (같은 Docker 이미지의 별도 서비스 + 전용 PostgreSQL 컨테이너) |
| `viewer/` (계약 없음) | `api/` · `public/` · `main.js` · `docker/server.mjs` |

## 작성 현황 (위임 추적용)

| 모듈 | spec | api | GATES.md | 현재 정본 |
|---|---|---|---|---|
| companies | ✅ | 해당없음 | 미작성 | 없음 |
| business-day | ✅ | ✅ | 미작성 | 없음 |
| daily-plan | ✅ | ✅ | 미작성 | 없음 |
| step-sender | ✅ | ✅ | 미작성 | 없음 |
| status-mail | ✅ | ✅ | 미작성 | 없음 |
| runner | ✅ | 해당없음 | 미작성 | 없음 |
| interfaces/sf-log-history | — | ✅ | 미작성 | `api/_sf-history.js` · `api/_tp1.js` 의 테이블 정의 |
| interfaces/sf-log-api | — | ✅ | 미작성 | `docs/external/log-api/` 의 연동가이드 v1.6 · 규격서 v1.7 |
| interfaces/kr-holiday-calendar | — | ✅ | 미작성 | 없음 |
| interfaces/smtp-mail | — | ✅ | 미작성 | 없음 |
