# 단계 보내기

> 방향: runner → step-sender
> 소유: sf-daily(step-sender) · 종류: 모듈 사이
> 상태: 동결 · 사람 확정

## 목적

업체 · 그날 · 단계 하나를 보내 달라는 요청과 그 결과.

## 표면

부르기: `sendStep(request)` — Promise 로 결과를 돌려준다.

요청:

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `company` | 문자열 | 예 | 업체 코드 |
| `date` | 문자열 `YYYY-MM-DD` | 예 | 그날 |
| `step` | `login` · `query` · `logout` | 예 | 단계 |
| `windowEnd` | `Date` | 예 | 보내는 범위의 끝 시각 |

결과:

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `outcome` | 아래 결과 표의 값 | 예 | 결과 |
| `resultCode` | 문자열 · `null` | 예 | 사업관리시스템 결과 코드. 보내지 않았거나 응답이 없으면 `null` |
| `message` | 문자열 · `null` | 예 | 사업관리시스템 결과 문구 또는 전송 실패 사유. 인증키를 담지 않는다 |

결과 값 — 이 표가 정본이며 step-sender 계약의 결과 표와 하나씩 맞는다:

| `outcome` | 결과 | 다시 부를 수 있는가 |
|---|---|---|
| `stored` | 정상 저장 | 아니오 |
| `error_response` | 오류 응답 | 예 |
| `send_failed` | 전송 실패 | 예 |
| `past_day` | 지난 날 | 아니오 |
| `window_passed` | 범위 지남 | 아니오 |
| `previous_missing` | 앞 단계 없음 | 예 |
| `already_stored` | 이미 저장됨 | 아니오 |
| `wait_10min` | 10분 대기 | 예 |
| `in_progress` | 이미 진행 중 | 예 |

## 오류

| 조건 | 알림 | 부르는 쪽의 행동 |
|---|---|---|
| 요청 필드가 없거나 값이 표 밖 | Promise 거부(`TypeError`) | 영구 실패 — 부르는 쪽 결함 |
| DB 에 닿지 못해 확인을 못 함 | Promise 거부(`Error`) | 재시도 가능 — 다음 회차 |
| 사업관리시스템 오류 · 닿지 못함 | 정상 결과(`error_response` · `send_failed`) | 재시도 가능 |

## 순서 · 중복

- 같은 요청이 동시에 여러 번 와도 사업관리시스템에 나가는 로그는 하나다(나머지는 `in_progress` 또는 `already_stored`).
- 단계 순서가 뒤집혀 와도 된다 — 앞 단계가 그날 정상 저장되지 않았으면 `previous_missing` 이다.

## 불변식

- `outcome` 이 `stored` · `error_response` · `send_failed` 일 때만 사업관리시스템에 요청이 나갔고, 그 요청마다 전송 이력에 한 행이 있다.
- 보낸 로그의 로그 일시 날짜는 `date` 와 같다.
- 결과 어디에도 인증키가 없다.
