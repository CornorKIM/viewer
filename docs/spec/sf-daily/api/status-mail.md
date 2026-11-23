# 현황 메일 보내기

> 방향: runner → status-mail
> 소유: sf-daily(status-mail) · 종류: 모듈 사이
> 상태: 동결 · 사람 확정

## 목적

그날을 주면 그날의 현황 메일을 한 번만 보내고 결과를 돌려준다.

## 표면

부르기: `sendStatusMail(date)` — `date` 는 그날 `YYYY-MM-DD`. 돌려받는 값(Promise):

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `outcome` | `sent` · `already_sent` · `failed` | 예 | 보냄 · 이미 보냄 · 실패 |
| `missingLogin` | 문자열 배열 | 예 | 로그인 건수가 0 인 업체 코드(명부 순서). `already_sent` 면 빈 배열 |
| `error` | 문자열 · `null` | 예 | `failed` 일 때 사유. 비밀번호를 담지 않는다 |

그날 메일을 보냈다는 기록은 sf-daily 전용 DB 에 남는다. 모양은 이 모듈 안의 일이다.

## 오류

| 조건 | 알림 | 부르는 쪽의 행동 |
|---|---|---|
| 메일 서버 접속 · 인증 · 수신 거부 | `outcome: failed` | 재시도 가능 |
| DB 에 닿지 못함 | `outcome: failed` | 재시도 가능 |
| `date` 형식이 틀림 | Promise 거부(`TypeError`) | 영구 실패 — 부르는 쪽 결함 |

## 순서 · 중복

- 같은 `date` 로 동시에 두 번 불러도 메일은 한 통이다. 하나는 `sent`, 나머지는 `already_sent` 다.

## 불변식

- `sent` 를 돌려줬으면 그 `date` 로 다시 불렀을 때 언제나 `already_sent` 다.
- `failed` 를 돌려줬으면 그 `date` 는 보낸 것으로 기록되지 않는다.
