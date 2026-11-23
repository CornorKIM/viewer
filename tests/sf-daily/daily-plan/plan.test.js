// Gates for docs/spec/sf-daily/spec/daily-plan.md — see GATES.md in this folder.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { applyBaseEnv } from '../../lib/env.js';
import { fn } from '../../lib/sut.js';
import { callInChild } from '../../lib/child.js';
import { clearDedicated, dedicatedRowCount, historySchemaSnapshot, closeDb } from '../../lib/db.js';
import { ROSTER, WINDOWS, QUERY_OFFSET_MIN } from '../../lib/roster.js';
import { kstAt, addDays, MIN } from '../../lib/kst.js';

applyBaseEnv();
before(async () => { await clearDedicated(); });
after(async () => { await closeDb(); });

const getDailyPlan = () => fn('daily-plan', 'getDailyPlan');
const asTimes = (plan) => plan.companies.map((c) => ({ code: c.code, login: +c.login, query: +c.query, logout: +c.logout }));

// One sample of many dates, shared by the range / spread / minute gates.
const SAMPLE_START = '2031-01-06';
const SAMPLE_DAYS = 200;
let sample = null;
async function samplePlans() {
    if (sample) return sample;
    const get = await getDailyPlan();
    sample = [];
    for (let i = 0; i < SAMPLE_DAYS; i++) {
        const date = addDays(SAMPLE_START, i);
        sample.push({ date, plan: await get(date) });
    }
    return sample;
}
const company = (plan, code) => plan.companies.find((c) => c.code === code);

test('DP-01 CO-09 로그인 계획 시각은 그 업체 유형의 로그인 범위 [시작, 끝) 안에 있다', { timeout: 120_000 }, async () => {
    for (const { date, plan } of await samplePlans()) {
        for (const r of ROSTER) {
            const [s, e] = WINDOWS[r.type].login;
            const t = +company(plan, r.code).login;
            assert.ok(t >= +kstAt(date, s) && t < +kstAt(date, e), `${date} ${r.code} login ${new Date(t).toISOString()}`);
        }
    }
});

test('DP-02 CO-10 조회 계획 시각은 그 업체의 로그인 계획 시각 + 30분 이상, + 3시간 미만이다', { timeout: 120_000 }, async () => {
    for (const { date, plan } of await samplePlans()) {
        for (const r of ROSTER) {
            const c = company(plan, r.code);
            const d = +c.query - +c.login;
            assert.ok(d >= QUERY_OFFSET_MIN[0] * MIN && d < QUERY_OFFSET_MIN[1] * MIN, `${date} ${r.code} query-login ${d / MIN} min`);
        }
    }
});

test('DP-03 CO-09 로그아웃 계획 시각은 그 업체 유형의 로그아웃 범위 [시작, 끝) 안에 있다', { timeout: 120_000 }, async () => {
    for (const { date, plan } of await samplePlans()) {
        for (const r of ROSTER) {
            const [s, e] = WINDOWS[r.type].logout;
            const t = +company(plan, r.code).logout;
            assert.ok(t >= +kstAt(date, s) && t < +kstAt(date, e), `${date} ${r.code} logout ${new Date(t).toISOString()}`);
        }
    }
});

test('DP-04 계획 시각은 범위 안에서 고르게 퍼진다 — 범위를 네 등분한 칸마다 15 % 이상 35 % 이하', { timeout: 120_000 }, async () => {
    const buckets = { login: [0, 0, 0, 0], query: [0, 0, 0, 0], logout: [0, 0, 0, 0] };
    let n = 0;
    for (const { date, plan } of await samplePlans()) {
        for (const r of ROSTER) {
            const c = company(plan, r.code);
            const w = WINDOWS[r.type];
            const pos = {
                login: (+c.login - +kstAt(date, w.login[0])) / (+kstAt(date, w.login[1]) - +kstAt(date, w.login[0])),
                query: (+c.query - +c.login - QUERY_OFFSET_MIN[0] * MIN) / ((QUERY_OFFSET_MIN[1] - QUERY_OFFSET_MIN[0]) * MIN),
                logout: (+c.logout - +kstAt(date, w.logout[0])) / (+kstAt(date, w.logout[1]) - +kstAt(date, w.logout[0])),
            };
            for (const k of Object.keys(buckets)) buckets[k][Math.min(3, Math.max(0, Math.floor(pos[k] * 4)))]++;
            n++;
        }
    }
    for (const [k, b] of Object.entries(buckets)) {
        for (const x of b) assert.ok(x / n >= 0.15 && x / n <= 0.35, `${k} quarters ${b.join('/')} of ${n}`);
    }
});

test('DP-05 같은 그날 다섯 업체의 로그인 계획 시각은 분 단위로 자르면 모두 다르다', { timeout: 120_000 }, async () => {
    for (const { date, plan } of await samplePlans()) {
        const minutes = plan.companies.map((c) => Math.floor(+c.login / MIN));
        assert.equal(new Set(minutes).size, minutes.length, `${date} login minutes ${minutes}`);
    }
});

test('DP-06 같은 그날을 다시 요청하면 처음과 같은 계획이다 (다른 그날을 사이에 불러도)', async () => {
    const get = await getDailyPlan();
    const a = asTimes(await get('2030-02-04'));
    await get('2030-02-05');
    const b = asTimes(await get('2030-02-04'));
    const c = asTimes(await get('2030-02-04'));
    assert.deepEqual(b, a);
    assert.deepEqual(c, a);
});

test('DP-07 서비스가 다시 시작된 뒤에도 같은 그날은 같은 계획이다', { timeout: 60_000 }, async () => {
    const first = await callInChild('daily-plan', 'getDailyPlan', ['2030-03-04']);
    assert.ok(first.ok, JSON.stringify(first.error));
    const second = await callInChild('daily-plan', 'getDailyPlan', ['2030-03-04']);
    assert.ok(second.ok, JSON.stringify(second.error));
    assert.deepEqual(asTimes(second.value), asTimes(first.value));
});

test('DP-08 두 곳에서 동시에 같은 그날을 처음 요청해도 남는 계획은 하나다', { timeout: 60_000 }, async () => {
    const get = await getDailyPlan();
    const date = '2030-04-01';
    const [c1, c2, p1, p2] = await Promise.all([
        callInChild('daily-plan', 'getDailyPlan', [date]),
        callInChild('daily-plan', 'getDailyPlan', [date]),
        get(date),
        get(date),
    ]);
    assert.ok(c1.ok && c2.ok, JSON.stringify([c1.error, c2.error]));
    const ref = asTimes(p1);
    for (const x of [c1.value, c2.value, p2]) assert.deepEqual(asTimes(x), ref);
    assert.deepEqual(asTimes(await get(date)), ref);
});

test('DP-09 정한 계획은 그날이 지나도 지워지지 않는다', { timeout: 60_000 }, async () => {
    const date = '2030-05-06';
    const during = await callInChild('daily-plan', 'getDailyPlan', [date], { env: { SF_DAILY_FAKE_NOW: kstAt(date, '09:00').toISOString() } });
    assert.ok(during.ok, JSON.stringify(during.error));
    const later = await callInChild('daily-plan', 'getDailyPlan', [date], { env: { SF_DAILY_FAKE_NOW: kstAt(addDays(date, 40), '09:00').toISOString() } });
    assert.ok(later.ok, JSON.stringify(later.error));
    assert.deepEqual(asTimes(later.value), asTimes(during.value));
});

test('DP-10 계획은 sf-daily 전용 DB 에 남고 전송 이력 DB 의 모양은 그대로다', async () => {
    const get = await getDailyPlan();
    const schema = await historySchemaSnapshot();
    const before = await dedicatedRowCount();
    await get('2030-06-03');
    assert.ok((await dedicatedRowCount()) > before, 'the dedicated DB holds the new plan');
    assert.equal(await historySchemaSnapshot(), schema);
});
