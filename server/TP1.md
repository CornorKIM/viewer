# 경기TP 스마트공장 유형1 — (주)CDR시스템 로그 연동

2-3(TP23)과 같은 Vercel 프로젝트·DB를 쓰지만 **파일·환경변수·이력 테이블·예약 작업이 모두 분리**되어 있습니다. 2-3 기존 파일은 수정하지 않았습니다.

```
[로그인/로그아웃] 브라우저 /tp1.html → Vercel /api/tp1-auth → 사업관리시스템 (DO6001 / DO6002)
[데이터 등록]     InfluxDB 센서 ← 회사 서버 tp1-sf-log-runner(10분) → 사업관리시스템 (DO6004, 최근 10분 데이터가 있을 때만)
[이력]            모두 tp1.sf_log_history → /tp1.html 하단 이력 표
```

| 구분 | 2-3 (TP23) | 유형1 (TP1) |
|---|---|---|
| 화면 | `/` (3D 뷰어), `/sflog.html` | `/tp1.html` |
| 로그인 API | `/api/sf-auth` | `/api/tp1-auth` |
| 데이터 등록 | `sf-log-runner.mjs` (raw_data) | `tp1-sf-log-runner.mjs` (InfluxDB 센서) |
| 설정 | `server/.env` | `server/.env.tp1` |
| 이력 | `tp23.sf_log_history` | `tp1.sf_log_history` |
| 예약 작업 | `TP23 SF Log Runner` | `TP1 SF Log Runner` |

## 추가된 파일

| 파일 | 역할 |
|---|---|
| `api/_tp1.js` | 유형1 공통(업체 목록, 센서 조회, 전송, 이력 저장) |
| `api/tp1-auth.js` | 로그인·로그아웃 + DO6001/DO6002 |
| `api/tp1-sf-log.js` | DO6004 확인(`?dry=1`)·테스트(`?test=1`)·수동 전송 |
| `api/tp1-sf-log-history.js` | 유형1 이력 조회 |
| `public/tp1.html` | 로그인 화면 + 센서 상태 + 이력 (아이폰 사파리 확인) |
| `server/tp1-sf-log-runner.mjs`, `run-once-tp1.bat`, `install-task-tp1.bat`, `env.tp1.example` | 회사 서버 10분 실행 |

## 1. Vercel 환경변수 추가 (Settings → Environment Variables, Production)

| 이름 | 값 |
|---|---|
| `SF_LOG_KEY_TP1_CDR` | (주)CDR시스템 로그API 인증키 |
| `TP1_PASSWORD_CDR` | `/tp1.html` 로그인 비밀번호(새로 정함) |
| `TP1_INFLUX_BUCKET_CDR` | CDR 센서 InfluxDB 버킷 |
| `TP1_INFLUX_TOPIC_CDR` | CDR 센서 topic 태그 값 |
| (기존) `PG_PASSWORD`, `INFLUX_TOKEN` | 이미 있으면 그대로 |

환경변수를 추가한 뒤에는 다시 배포해야 반영됩니다.

## 2. 배포

`viewer` 폴더에서 `deploy.bat` (또는 `npx vercel --prod`).

## 3. 테스트 (실적에 잡히지 않음)

1. `https://viewer-five-beta.vercel.app/tp1.html?sftest=1` 접속
2. 아이디 `(주)CDR시스템` (공백·(주) 생략 가능), 비밀번호 = `TP1_PASSWORD_CDR`
3. 로그인 결과 `DO6999 → AP1028`이면 키·형식 정상
4. 센서 칸에 `N건 · NB`가 나오면 센서 조회 정상(오류면 버킷·topic·토큰 확인)
5. 로그아웃 → `AP1028` 확인. 테스트로 로그인한 세션은 주소와 관계없이 로그아웃도 테스트로 전송됩니다.
6. 데이터 등록 테스트: 회사 서버에서 `install-task-tp1.bat test` → `DO6999 AP1028`

## 4. 회사 서버 10분 실행 (데이터 등록)

1. `server\env.tp1.example` → 같은 폴더에 `.env.tp1`로 복사, 값 입력(`.env*`라서 git에 올라가지 않음)
2. `install-task-tp1.bat check` → 전송 예정 내용 확인(전송 없음)
3. `install-task-tp1.bat test` → `AP1028` 확인
4. `install-task-tp1.bat`을 관리자 권한으로 실행 → 작업 `TP1 SF Log Runner` 등록
5. 기록: `server\logs\tp1-sf-log.log`, 화면 `/tp1.html` 이력 표

## 실제 운영 전환

- 로그인·로그아웃: `?sftest=1` 없이 `/tp1.html` 사용
- 데이터 등록: 4번 작업 등록 후 자동
- 같은 인증키로 10분 안에 여러 건이 나가면 뒤의 건은 AP1029(수신만)입니다. 정상 범위입니다.
