# 하루 계획

> 방향: daily-plan → runner
> 소유: sf-daily(daily-plan) · 종류: 모듈 사이
> 상태: 동결 · 사람 확정

## 목적

그날을 주면 업체마다 세 단계의 계획 시각을 돌려준다. 처음 부를 때 정하고, 그 뒤로는 같은 값을 돌려준다.

## 표면

부르기: `getDailyPlan(date)` — `date` 는 그날 `YYYY-MM-DD`. 돌려받는 값(Promise):

| 필드 | 타입 | 필수 | 뜻 |
|---|---|---|---|
| `date` | 문자열 `YYYY-MM-DD` | 예 | 그날 |
| `companies` | 배열 | 예 | 업체 명부 순서의 다섯 항목 |
| `companies[].code` | 문자열 | 예 | 업체 코드(`A` · `B` · `C` · `D` · `CDR`) |
| `companies[].login` | `Date` | 예 | 로그인 계획 시각 |
| `companies[].query` | `Date` | 예 | 조회 계획 시각 |
| `companies[].logout` | `Date` | 예 | 로그아웃 계획 시각 |

계획은 sf-daily 전용 DB 에 남는다. 테이블 모양은 이 모듈 안의 일이다.

## 오류

| 조건 | 알림 | 부르는 쪽의 행동 |
|---|---|---|
| DB 에 닿지 못함 · 쿼리 실패 | Promise 거부(`Error`) | 재시도 가능 — 다음 회차에 다시 부른다 |
| `date` 가 `YYYY-MM-DD` 가 아니거나 없는 날짜 | Promise 거부(`TypeError`) | 영구 실패 — 부르는 쪽 결함 |

## 순서 · 중복

- 같은 `date` 로 몇 번을 불러도, 동시에 불러도 같은 계획이 돌아온다.
- 서로 다른 `date` 는 서로 무관하다. 지난 날짜를 불러도 그날 정했던 계획이 돌아오고, 정한 적이 없으면 새로 정한다.

## 불변식

- 시각은 모두 그날 KST 날짜 안에 있다.
- `login < query < logout` 이다.
- 한 번 돌려준 값은 같은 `date` 에 대해 바뀌지 않는다(초 단위로 같다).

## 이름공간

`login` · `query` · `logout` 은 이 표면의 단계 이름이다. 업체 명부 단계 표의 로그인 · 조회 · 로그아웃과 같은 뜻이다.
