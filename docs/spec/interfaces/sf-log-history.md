# 전송 이력

> 방향: viewer(소유) ↔ sf-daily(step-sender 쓰기 · 읽기, status-mail 읽기)
> 소유: viewer · 종류: 산출물 사이
> 상태: 동결

## 목적

사업관리시스템에 보낸 로그와 그 응답을 공유 PostgreSQL 테이블 두 개에 남기고, 업체 · 그날 · 단계의 정상 저장 건수를 한 가지 셈으로 정한다. 뷰어 화면 로그인 · Vercel 쪽 전송 · sf-daily 자동 전송이 같은 테이블에 쓴다.

## 표면

### 테이블 두 개는 유형으로 갈린다

| 유형 | 테이블 | 업체 열 |
|---|---|---|
| 유형2-3 | `tp23.sf_log_history` | `set_code` (A · B · C · D) |
| 유형1 | `tp1.sf_log_history` | `company_code` (CDR) |

### 두 테이블이 함께 가진 열

| 열 | 타입 | 뜻 |
|---|---|---|
| `id` | bigserial | 행 식별 |
| `sent_at` | timestamptz | 행을 쓴 시각(DB 기본값 now()) |
| `test` | boolean | DO6999 시험 전송이면 참 |
| `use_se` | varchar(10) | 사용 구분 코드 |
| `log_dt` | varchar(23) | 보낸 로그 일시(KST 문자열) |
| `sys_user` | varchar(60) | 시스템 사용자 값 |
| `conect_ip` | varchar(30) | 접속 IP |
| `data_usgqty` | bigint | 데이터 사용량 |
| `http_status` | integer · null | HTTP 상태 |
| `result_code` | varchar(10) · null | 사업관리시스템 결과 코드 |
| `result_msg` | varchar(200) · null | 결과 문구 |
| `result_detail` | text · null | 결과 상세 |
| `recptn_dt` | varchar(30) · null | 사업관리시스템 수신 시각 |
| `error` | text · null | 요청이 닿지 못했을 때의 사유 |

유형2-3 테이블에는 `equipment_no` 가, 유형1 테이블에는 `source` 가 더 있다.

### 자동 전송 행은 이렇게 구별된다

| 유형 | 구별 |
|---|---|
| 유형1 | `source = 'auto'` |
| 유형2-3 | 그 행의 `id` 가 sf-daily 의 자동 전송 기록(스키마 `sf_daily`)에 있다 |

- **기존 두 테이블의 열은 바꾸지 않는다.** 유형2-3 테이블에 열을 더하지 않고, 자동 전송 표시는 sf-daily 쪽 기록이 갖는다.
- **sf-daily 가 쓰는 유형2-3 행의 `equipment_no` 는 업체 명부(`sf-daily/spec/companies.md`)의 그 업체 장비 번호다.**

### 정상 저장 건수 — 이 셈이 정본이다

업체 X · 그날 D · 사용 구분 U 의 정상 저장 건수는 X 의 유형 테이블에서 아래를 모두 만족하는 행의 수다.

| 조건 | |
|---|---|
| 업체 열 = X | |
| `sent_at` 의 Asia/Seoul 날짜 = D | |
| `use_se` = U | |
| `result_code` = `AP1002` | |
| `test` = 거짓 | |

### 업체의 가장 최근 요청

업체 X 의 가장 최근 요청 시각은 X 의 유형 테이블에서 업체 열 = X 인 행 중 가장 큰 `sent_at` 이다(시험 · 오류 행 포함).

## 오류

| 조건 | 알림 | 부르는 쪽의 행동 |
|---|---|---|
| DB 에 닿지 못함 · 쿼리 실패 | 쿼리 오류 | 재시도 가능 |

## 순서 · 중복

- 행은 쌓이기만 한다. 고치거나 지우지 않는다.
- 같은 로그가 두 행으로 남을 수 있다(두 곳이 각자 보낸 경우). 셈은 행을 그대로 센다.

## 불변식

- 행의 어느 열에도 인증키가 없다.
- `sent_at` 은 쓴 순서대로 커진다고 가정하지 않는다 — 셈은 날짜와 조건으로만 한다.

## 이름공간

`set_code` · `company_code` 는 테이블 열 이름이다. 업체 명부의 「코드」 와 값이 같다.
