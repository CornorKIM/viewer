# 영업일 판단

> 방향: business-day → runner
> 소유: sf-daily(business-day) · 종류: 모듈 사이
> 상태: 동결

## 목적

시점 하나를 주면 그날(KST)이 영업일인지, 아니면 왜 아닌지를 돌려준다.

## 표면

부르기: `judgeBusinessDay(at)` — `at` 은 판단할 시점(JavaScript `Date`). 돌려받는 값:

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `date` | 문자열 `YYYY-MM-DD` | 예 | 그날(KST) |
| `result` | `business` · `off` · `unknown` | 예 | 영업일 · 쉬는 날 · 확인 불가 |
| `reason` | 아래 사유 표의 값 · `null` | 예 | `business` 이면 `null` |
| `holidayName` | 문자열 · `null` | 예 | `reason` 이 `holiday` 일 때 달력의 일정 이름, 그 밖에는 `null` |

사유 값 — 이 표가 정본이다:

| `reason` | `result` | 뜻 |
|---|---|---|
| `saturday` | `off` | 토요일 |
| `sunday` | `off` | 일요일 |
| `may_first` | `off` | 5월 1일 |
| `holiday` | `off` | 달력의 「공휴일」 |
| `calendar_fetch_failed` | `unknown` | 달력 받기 실패 |
| `calendar_format_error` | `unknown` | 달력 형식 오류 |
| `year_missing` | `unknown` | 그해 1월 1일 「공휴일」 없음 |

## 오류

| 조건 | 알림 | 부르는 쪽의 행동 |
|---|---|---|
| 달력을 받지 못함 · 형식 오류 · 그해 자료 없음 | `result: unknown` 과 사유 | 재시도 가능 — 다음 회차에 다시 부른다 |
| `at` 이 유효한 `Date` 가 아님 | 예외(`TypeError`) | 영구 실패 — 부르는 쪽 결함 |

- **달력 문제로 예외를 던지지 않는다.** 달력 문제는 언제나 `unknown` 으로 돌아온다.

## 순서 · 중복

- 같은 시점으로 여러 번 불러도 된다. 부를 때마다 달력을 새로 받으므로 달력이 그사이 바뀌면 결과가 바뀔 수 있다.

## 불변식

- `date` 는 `at` 의 UTC+9 날짜다.
- `result` 가 `business` 이면 `reason` 과 `holidayName` 은 `null` 이다.
- 토요일 · 일요일 · 5월 1일의 판단은 달력 상태와 무관하게 같다.

## 이름공간

`reason` 값은 이 표면의 이름이다. 업체 명부 · 이력 테이블의 이름과 겹치지 않는다.
