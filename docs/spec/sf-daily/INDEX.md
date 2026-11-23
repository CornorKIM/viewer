# sf-daily 색인

영업일마다 다섯 업체의 로그인 · 조회 · 로그아웃 로그를 사업관리시스템에 자동으로 보내고, 23시에 그날 현황을 메일로 보내는 서비스.

- [spec/companies.md](spec/companies.md) — 다섯 업체의 코드 · 유형 · 이름 · 인증키 설정 · 시스템 사용자 값과 단계 목록, 유형별 시각 범위. 업체를 더하거나 빼고, 시각 범위를 바꿀 때 읽는다.
- [spec/business-day.md](spec/business-day.md) — 그날(KST)과 영업일의 뜻, 쉬는 날 사유, 휴일 달력을 확인하지 못할 때의 동작. 휴일 처리 규칙을 바꾸거나 휴일 출처를 바꿀 때 읽는다.
- [spec/daily-plan.md](spec/daily-plan.md) — 업체 · 그날마다 단계별 보낼 시각을 범위 안에서 한 번 정해 유지하는 규칙. 보내는 시각이 정해지는 방식을 바꿀 때 읽는다.
- [spec/step-sender.md](spec/step-sender.md) — 단계 하나를 보내기 전 확인 순서, 보내는 로그 값, 결과 목록과 이력 기록. 중복 · 지난 날 · 앞 단계 규칙이나 보내는 값을 바꿀 때 읽는다.
- [spec/status-mail.md](spec/status-mail.md) — 23시 현황 메일의 내용, 로그인 0 경고, 하루 한 통 규칙. 메일 내용이나 받는 사람 설정을 바꿀 때 읽는다.
- [spec/runner.md](spec/runner.md) — 서비스 설정 표와 시작 거부 조건, 영업일에만 계획대로 보내고 다시 보내는 규칙, 메일 시각. 설정을 더하거나 언제 무엇을 보내는지를 바꿀 때 읽는다.
- [api/business-day.md](api/business-day.md) — 영업일 판단을 부르는 모양과 사유 값. runner 와 business-day 사이를 구현할 때 읽는다.
- [api/daily-plan.md](api/daily-plan.md) — 하루 계획을 받는 모양과 불변식. runner 와 daily-plan 사이를 구현할 때 읽는다.
- [api/step-sender.md](api/step-sender.md) — 단계 보내기 요청 · 결과 값과 다시 부를 수 있는지. runner 와 step-sender 사이를 구현할 때 읽는다.
- [api/status-mail.md](api/status-mail.md) — 현황 메일 보내기 결과 값과 하루 한 통 불변식. runner 와 status-mail 사이를 구현할 때 읽는다.
