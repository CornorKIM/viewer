# 스마트공장 로그 전송 — 회사 서버 실행판

```
미니PC(업체 4곳) → DB(syntec_cnc.raw_data) → 회사 서버(이 폴더, 10분마다) → 사업관리시스템(log.smart-factory.kr)
```

- 동작은 Vercel의 `/api/sf-log`와 같습니다. 업체별로 최근 10분 동안 DB에 실제 등록된 데이터가 있으면 그 업체 인증키로 **DO6004(데이터 등록)** 1건을 보내고, 없으면 보내지 않습니다.
- 결과는 `tp23.sf_log_history`에 저장되어 뷰어의 `/sflog.html` 이력 화면에 그대로 나옵니다.
- Vercel 실행 횟수 제한과 무관합니다. 남는 제한은 사업관리시스템 규칙(10분 간격 저장, 하루 144건)뿐입니다.

## 파일

| 파일 | 역할 |
|---|---|
| `sf-log-runner.mjs` | 전송 프로그램(1회 실행). `../api/_sf-send.js`·`_sf-codes.js`·`_sf-history.js`를 그대로 사용 |
| `env.example` | 설정 예시 → 같은 폴더에 `.env`로 복사해 값 입력 |
| `run-once.bat` | 1회 실행 + `logs\sf-log.log`에 기록 (작업 스케줄러가 호출) |
| `install-task.bat` | 10분마다 자동 실행 등록 / 확인 / 테스트 / 삭제 |

## 회사 서버(Windows) 설치 순서

1. **Node.js 22 이상** 설치 (https://nodejs.org, LTS).
2. **viewer 저장소 받기**: `setup.bat norun` 실행(clone + `npm install`) 또는 `git clone https://github.com/CornorKIM/viewer.git` 후 `viewer` 폴더에서 `npm install`.
3. **설정 파일**: `viewer\server\env.example`을 같은 폴더에 `.env`로 복사하고 값 입력
   - `PG_PASSWORD` — DB 비밀번호(Vercel의 `PG_PASSWORD`와 같은 값)
   - `PG_HOST` — 이 서버가 DB 서버(175.193.55.102)와 같은 장비면 `localhost`, 아니면 비워 둠
   - `SF_LOG_KEY_A`~`D` — 업체별 로그API 인증키(Vercel에 등록한 값과 같음)
   - (선택) `SF_LOG_IP_A`~`D` 또는 `SF_LOG_DEFAULT_IP` — 접속 IP. 비우면 DB 서버 IP
4. **확인(전송 없음)**: `install-task.bat check` → 업체별 최근 10분 등록 건수와 전송 예정 내용 표시
5. **키 확인(테스트 전송)**: `install-task.bat test` → DO6999(통계 제외)로 전송, 업체마다 **AP1028**이 나오면 정상
6. **자동 실행 등록**: `install-task.bat`을 **관리자 권한으로 실행** → 작업 `TP23 SF Log Runner`가 10분마다 실행(로그인 없이도, 재부팅 후에도 동작)
7. 동작 확인: `viewer\server\logs\sf-log.log` 또는 뷰어 `/sflog.html`

- 삭제: `install-task.bat remove`
- 같은 PC에 예전 작업 `TP23 Smart Factory Log`(Vercel `/api/sf-log` 호출)가 있으면 중복 전송을 막기 위해 등록 시 자동 삭제합니다.

## 서버 쪽 확인 사항

| 항목 | 내용 |
|---|---|
| 상시 가동 | 서버가 꺼져 있는 동안의 로그는 보낼 수 없음(당일 로그는 당일에만 전송 가능) |
| 외부 통신 | 서버에서 `https://log.smart-factory.kr`(443)으로 나가는 통신 허용 |
| DB 접속 | 서버에서 DB(175.193.55.102:5432) 접속 가능 |
| 시각 | 서버 시계가 정확해야 함(로그 일시는 한국 시간으로 계산, 오늘 날짜가 아니면 AP1027) |
| 중복 방지 | Vercel 쪽 10분 호출(GitHub Actions `sf-log.yml`, 다른 PC의 `tools/sf-log-schedule.bat`)과 동시에 돌리지 않음. 동시에 돌면 10분 안 재전송(AP1029, 수신만)이 생김 |

## 리눅스 서버라면

```
cd /경로/viewer && npm install
cp server/env.example server/.env   # 값 입력
crontab -e
*/10 * * * * cd /경로/viewer/server && node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON --env-file=.env sf-log-runner.mjs >> logs/sf-log.log 2>&1
```
(`logs` 폴더는 먼저 `mkdir -p /경로/viewer/server/logs`로 생성)
