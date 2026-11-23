# 운영 안내 — factory-3d-viewer (twin.smartline.kr)

이 서버(WSL2 + Docker)에서 3D 공장 뷰어와 스마트공장 로그 자동 전송을 운영하는 방법. 손대기 전에 [hazards.md](hazards.md) 를 먼저 읽는다.

## 무엇이 떠 있나

| 컨테이너 | 하는 일 | 바깥에서 |
|---|---|---|
| `factory-3d-viewer` | 3D 화면 · api/ 함수 · 이력 화면(sflog.html) | https://twin.smartline.kr (gateway → 호스트 20040) |
| `sf-daily` | 영업일 자동 로그 전송(로그인 · 조회 · 로그아웃) · 23시 현황 메일 | 없음 |
| `sf-daily-db` | sf-daily 전용 PostgreSQL(하루 계획 · 전송 일지 · 메일 기록) | 없음(포트 안 엶) |

- 전송 이력은 Windows PostgreSQL(175.193.55.102, 여러 서비스 공용)의 `tp23.sf_log_history` · `tp1.sf_log_history` 에 쌓인다. 여기엔 행만 더한다.
- 센서 값은 같은 서버의 `sl-influxdb`(smart-line2 프로젝트)에서 읽는다.
- `sf-daily` 는 `factory-3d-viewer` 와 같은 이미지를 쓴다. 빌드는 viewer 하나로 한다.

## 띄우기 · 다시 띄우기

```bash
cd ~/projects/factory-3d-viewer
docker compose up -d --build        # 코드가 바뀌었을 때(이미지 다시 만들고 셋 다 다시 띄움)
docker compose up -d --force-recreate sf-daily   # .env 만 바꿨을 때(해당 서비스만)
docker compose ps
docker compose logs -f sf-daily     # 자동 전송 기록
```

`docker compose up -d --build` 하는 동안 twin.smartline.kr 이 몇 초 끊긴다. sf-daily 는 종료 신호를 받으면 보내던 것을 최대 15초 기다린 뒤 끝난다.

## .env (git 밖, 운영 비밀값)

`.env.example` 이 항목 목록이다. 주요 항목:

| 항목 | 뜻 |
|---|---|
| `PG_PASSWORD` | Windows PostgreSQL 비밀번호(설비 좌표 · 전송 이력) |
| `INFLUX_TOKEN` · `INFLUX_URL` | 센서 InfluxDB(`http://sl-influxdb:8086`) |
| `SF_LOG_KEY_A`~`D` · `SF_LOG_KEY_TP1_CDR` | 업체 인증키(A 목공소 봄 · B 이레공방 · C 브랜드스미스 · D 비스트럭처 · CDR (주)CDR시스템) |
| `SF_DAILY_ENABLED` | `true` 면 자동 전송 · 현황 메일을 한다. `false` 면 서비스는 떠 있되 아무것도 안 보낸다 |
| `SF_DB_PASSWORD` | sf-daily-db 비밀번호. 비면 sf-daily 가 시작을 거부한다 |
| `SMTP_*` · `SF_REPORT_TO` | 현황 메일 계정(Gmail 앱 비밀번호) · 받는 사람(쉼표로 여럿) |
| `CRON_SECRET` | 전송 API(`/api/sf-log` 등)를 바깥에서 못 부르게 막는 값 |
| `TRUSTED_PROXIES` | gateway 컨테이너 IP. 실제 접속자 IP 를 읽는 데 쓴다 |

- **인증키에는 `$` 가 들어 있다.** 반드시 작은따옴표로 감싼다: `SF_LOG_KEY_A='$5$API$...'`. 안 감싸면 Docker 가 `$` 뒤를 변수로 읽어 키가 깨진다.
- 키를 바꾼 뒤: `docker compose up -d --force-recreate viewer sf-daily`, 그리고 `docker compose exec viewer node -e 'console.log(process.env.SF_LOG_KEY_A.length)'` 로 길이(50)를 확인한다.
- `SF_DAILY_FAKE_NOW` 는 시험용이다. 운영 .env 에 있으면 sf-daily 가 시작을 거부한다.

## 자동 전송이 하는 일

- 영업일(월~금, 공휴일 · 대체 · 임시공휴일 · 선거일 · 5월 1일 제외)에만 보낸다. 휴일은 구글 「대한민국의 휴일」 달력으로 판단하고, 확인이 안 되면 그날은 보내지 않는다.
- 업체마다 매일 시각을 무작위로 정한다: 로그인 10~12시(CDR 10~11시) → 조회 로그인 30분~3시간 뒤 → 로그아웃 17~20시(CDR 17~22시). 하루 계획은 sf-daily 로그의 「하루 계획」 줄에 나온다.
- 같은 단계가 그날 이미 정상 저장(AP1002)돼 있으면 보내지 않는다(뷰어 화면 로그인 · Vercel 쪽 전송도 센다). 앞 단계가 저장되지 않았으면 다음 단계는 보내지 않는다.
- 영업일 23:00 에 현황 메일(업체별 로그인 · 조회 · 로그아웃 정상 저장 건수)을 보낸다. 로그인 0 인 업체는 빨간 줄과 제목 「[로그인 누락]」 으로 알린다.

## 자주 하는 일

**자동 전송 끄기 · 켜기** — `.env` 의 `SF_DAILY_ENABLED` 를 바꾸고 `docker compose up -d --force-recreate sf-daily`.

**임시공휴일이 갑자기 내일로 발표됐을 때** — 달력에 하루 이틀 늦게 오를 수 있다. 그날 0시 전에 끄고 다음 날 다시 켠다.

**로그인 누락 메일을 받았을 때(수동 로그인)** — 뷰어 화면에서 그 업체로 로그인하면 실제 로그인 로그가 나간다(아이디 = 업체 이름, 비밀번호 = 장비 번호). 또는:

```bash
docker compose exec viewer node docker/sf-flow.mjs A --steps login        # A·B·C·D·CDR
docker compose exec viewer node docker/sf-flow.mjs A --steps login --dry  # 보내지 않고 내용만
```

`sf-flow.mjs` 는 단계 사이를 10분씩 기다린다(같은 키로 10분 안에 다시 보내면 AP1029 로 저장되지 않는다). 수동 전송은 그날 자동 전송의 「이미 저장됨」 판단에 들어간다.

**전송 결과 보기** — https://twin.smartline.kr/sflog.html (유형 · 업체 · 기간 필터). 결과 코드 뜻은 화면 아래 「결과 코드 설명」.

## 고장 대응

| 증상 | 볼 곳 |
|---|---|
| 23시 메일이 안 옴 | `docker compose logs sf-daily` 의 「현황 메일」 줄. 실패면 5분 간격으로 그날 안에 다시 보낸다. SMTP 앱 비밀번호가 바뀌었는지 확인 |
| sf-daily 가 계속 재시작 | 로그 첫 줄의 「설정 오류 …」. 빠진 .env 항목을 채운다 |
| 「영업일 판단 … unknown」 이 이어짐 | 구글 달력에 닿지 못함. 10분마다 다시 본다. 그동안은 보내지 않는다 |
| 이력 화면이 빈다 · DB 오류 | Windows PostgreSQL(175.193.55.102:5432)이 살아 있는지. Windows 재부팅 뒤 portproxy 를 확인 |
| 센서 값이 안 나옴 | `sl-influxdb` 컨테이너와 `INFLUX_TOKEN` |
| twin.smartline.kr 이 안 열림 | `docker compose ps`, 그다음 gateway(`~/projects/gateway`, server 블록 7e) |

- 한 회차가 5분 넘게 멈추면 sf-daily 가 스스로 끝나고 Docker 가 다시 띄운다. 로그에 종료 코드 2 가 남는다.
- 인증서는 certbot 이 자동 갱신한다(`/etc/letsencrypt/live/twin.smartline.kr`). 갱신 뒤 gateway 가 새 인증서를 읽게 `docker compose exec nginx nginx -s reload`(gateway 폴더).

## 시험

```bash
tests/run.sh                                         # 전체(약 15분)
tests/run.sh 'tests/sf-daily/step-sender/**/*.test.js'   # 일부
```

시험은 바깥으로 나가는 길이 없는 Docker 네트워크에서 가짜 사업관리시스템 · 가짜 달력 · 가짜 메일 서버 · 버리는 DB 로만 돈다.
